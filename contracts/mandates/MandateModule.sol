// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMandateModule} from "./IMandateModule.sol";
import {MandateTypes} from "./MandateTypes.sol";

/// @title MandateModule
/// @notice Revocable, budget-limited authority for an AI purchasing agent.
/// @dev The coordinator evaluates the full policy off-chain, then calls this contract
///      to enforce the security-critical shared state: agent binding, TTL, revocation,
///      action scope, one-time authorization and aggregate budget.
contract MandateModule is IMandateModule {
    error NotOwner();
    error NotAdmin();
    error CoordinatorAlreadyConfigured();
    error NotCoordinator();
    error UnknownMandate();
    error InvalidTerms();
    error MandateNotUsable();
    error UnauthorizedAgent();
    error UnauthorizedPaymentDelegate();
    error ActionNotAllowed();
    error AmountExceedsLimit();
    error AuthorizationExists();
    error AuthorizationNotActive();
    error InvalidAuthorizationExpiry();
    error MandateChanged();

    address public immutable admin;
    address public coordinator;
    mapping(bytes32 => MandateTypes.Mandate) private mandates;
    mapping(bytes32 => MandateTypes.Authorization) private authorizations;
    mapping(address => uint256) private ownerNonces;

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator();
        _;
    }

    event CoordinatorConfigured(address indexed coordinator);

    constructor() {
        admin = msg.sender;
    }

    /// @notice Wires the facade after both contracts have been deployed.
    /// @dev Kept outside IMandateModule: the purchase program never administers this module.
    function setCoordinator(address coordinator_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (coordinator_ == address(0)) revert InvalidTerms();
        if (coordinator != address(0)) revert CoordinatorAlreadyConfigured();
        coordinator = coordinator_;
        emit CoordinatorConfigured(coordinator_);
    }

    function createMandate(MandateTypes.Terms calldata terms) external returns (bytes32 mandateId) {
        _validateTerms(terms, 0, 0);
        mandateId = keccak256(abi.encodePacked(block.chainid, address(this), msg.sender, ownerNonces[msg.sender]++));
        MandateTypes.Mandate storage mandate = mandates[mandateId];
        mandate.owner = msg.sender;
        mandate.terms = terms;
        mandate.status = MandateTypes.Status.Active;
        mandate.revision = 1;
        emit MandateCreated(mandateId, msg.sender, terms.agent, terms.policyHash, terms.expiresAt);
    }

    function amendMandate(bytes32 mandateId, MandateTypes.Terms calldata terms) external {
        MandateTypes.Mandate storage mandate = _ownedMutableMandate(mandateId);
        _validateTerms(terms, mandate.spent, mandate.reserved);
        mandate.terms = terms;
        unchecked { mandate.revision++; }
        emit MandateAmended(mandateId, mandate.revision, terms.policyHash, terms.expiresAt);
    }

    function revokeMandate(bytes32 mandateId) external {
        MandateTypes.Mandate storage mandate = mandates[mandateId];
        if (mandate.owner == address(0)) revert UnknownMandate();
        if (msg.sender != mandate.owner) revert NotOwner();
        if (mandate.status == MandateTypes.Status.Revoked) return;
        mandate.status = MandateTypes.Status.Revoked;
        emit MandateRevoked(mandateId, msg.sender);
    }

    function isUsable(bytes32 mandateId, address agent) external view returns (bool) {
        MandateTypes.Mandate storage mandate = mandates[mandateId];
        return _isUsable(mandate) && mandate.terms.agent == agent;
    }

    function getMandate(bytes32 mandateId) external view returns (MandateTypes.Mandate memory) {
        return mandates[mandateId];
    }

    function getAuthorization(bytes32 authorizationId) external view returns (MandateTypes.Authorization memory) {
        return authorizations[authorizationId];
    }

    function reserveAuthorization(
        bytes32 mandateId,
        address agent,
        address paymentDelegate,
        uint128 amount,
        uint8 action,
        bytes32 intentHash,
        uint64 authorizationExpiresAt
    ) external onlyCoordinator returns (bytes32 authorizationId) {
        MandateTypes.Mandate storage mandate = mandates[mandateId];
        if (!_isUsable(mandate)) revert MandateNotUsable();
        if (mandate.terms.agent != agent) revert UnauthorizedAgent();
        if (mandate.terms.paymentDelegate != paymentDelegate) {
            revert UnauthorizedPaymentDelegate();
        }
        if (action >= 32 || (mandate.terms.allowedActions & (uint32(1) << action)) == 0) revert ActionNotAllowed();
        if (amount == 0 || amount > mandate.terms.maxPerOperation || uint256(mandate.spent) + mandate.reserved + amount > mandate.terms.maxTotal) {
            revert AmountExceedsLimit();
        }
        if (authorizationExpiresAt <= block.timestamp || authorizationExpiresAt > mandate.terms.expiresAt) {
            revert InvalidAuthorizationExpiry();
        }

        authorizationId = keccak256(abi.encodePacked(mandateId, intentHash));
        if (authorizations[authorizationId].mandateId != bytes32(0)) revert AuthorizationExists();
        authorizations[authorizationId] = MandateTypes.Authorization({
            mandateId: mandateId,
            amount: amount,
            expiresAt: authorizationExpiresAt,
            mandateRevision: mandate.revision,
            active: true
        });
        mandate.reserved += amount;
        emit AuthorizationReserved(authorizationId, mandateId, intentHash, amount, authorizationExpiresAt);
    }

    function consumeAuthorization(bytes32 authorizationId) external {
        MandateTypes.Authorization storage authorization = authorizations[authorizationId];
        if (!authorization.active || authorization.expiresAt <= block.timestamp) revert AuthorizationNotActive();
        MandateTypes.Mandate storage mandate = mandates[authorization.mandateId];
        if (!_isUsable(mandate)) revert MandateNotUsable();
        if (authorization.mandateRevision != mandate.revision) revert MandateChanged();
        if (mandate.terms.paymentDelegate != msg.sender) {
            revert UnauthorizedPaymentDelegate();
        }

        authorization.active = false;
        mandate.reserved -= authorization.amount;
        mandate.spent += authorization.amount;
        emit AuthorizationConsumed(authorizationId, authorization.mandateId, msg.sender);
    }

    function cancelAuthorization(bytes32 authorizationId) external onlyCoordinator {
        MandateTypes.Authorization storage authorization = authorizations[authorizationId];
        if (!authorization.active) revert AuthorizationNotActive();
        authorization.active = false;
        mandates[authorization.mandateId].reserved -= authorization.amount;
        emit AuthorizationCancelled(authorizationId, authorization.mandateId);
    }

    /// @notice Releases budget from a reservation that can no longer be consumed.
    /// @dev Permissionless so an expired reservation can never lock a user's budget.
    function releaseExpiredAuthorization(bytes32 authorizationId) external {
        MandateTypes.Authorization storage authorization = authorizations[authorizationId];
        if (!authorization.active || authorization.expiresAt > block.timestamp) revert AuthorizationNotActive();
        authorization.active = false;
        mandates[authorization.mandateId].reserved -= authorization.amount;
        emit AuthorizationCancelled(authorizationId, authorization.mandateId);
    }

    function _ownedMutableMandate(bytes32 mandateId) private view returns (MandateTypes.Mandate storage mandate) {
        mandate = mandates[mandateId];
        if (mandate.owner == address(0)) revert UnknownMandate();
        if (msg.sender != mandate.owner) revert NotOwner();
        if (mandate.status != MandateTypes.Status.Active || block.timestamp >= mandate.terms.expiresAt) {
            revert MandateNotUsable();
        }
    }

    function _validateTerms(MandateTypes.Terms calldata terms, uint128 spent, uint128 reserved) private pure {
        if (
            terms.agent == address(0) ||
            terms.paymentDelegate == address(0) ||
            terms.expiresAt <= terms.validAfter ||
            terms.maxPerOperation == 0 ||
            terms.maxTotal < terms.maxPerOperation ||
            terms.maxTotal < uint256(spent) + reserved ||
            terms.allowedActions == 0 ||
            terms.policyHash == bytes32(0)
        ) revert InvalidTerms();
    }

    function _isUsable(MandateTypes.Mandate storage mandate) private view returns (bool) {
        return mandate.status == MandateTypes.Status.Active && block.timestamp >= mandate.terms.validAfter && block.timestamp < mandate.terms.expiresAt;
    }
}
