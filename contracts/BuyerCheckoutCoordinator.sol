// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMandateModule} from "./mandates/IMandateModule.sol";

/// @notice Minimal purchase-program boundary for the MVP.
/// @dev Deploy MandateModule with this contract as `coordinator`. The off-chain
///      policy engine may call this contract only after it validates the full policy.
contract BuyerCheckoutCoordinator {
    error NotPolicyEngine();

    IMandateModule public immutable mandates;
    address public immutable policyEngine;

    event PurchaseAuthorizationRequested(bytes32 indexed mandateId, bytes32 indexed intentHash, bytes32 authorizationId);

    constructor(IMandateModule mandates_, address policyEngine_) {
        if (address(mandates_) == address(0) || policyEngine_ == address(0)) revert NotPolicyEngine();
        mandates = mandates_;
        policyEngine = policyEngine_;
    }

    /// @notice The coordinator knows the mandate API, not its implementation or storage.
    function reservePaymentAuthorization(
        bytes32 mandateId,
        address agent,
        address paymentDelegate,
        uint128 amount,
        uint8 action,
        bytes32 intentHash,
        uint64 authorizationExpiresAt
    ) external returns (bytes32 authorizationId) {
        if (msg.sender != policyEngine) revert NotPolicyEngine();
        authorizationId = mandates.reserveAuthorization(
            mandateId,
            agent,
            paymentDelegate,
            amount,
            action,
            intentHash,
            authorizationExpiresAt
        );
        emit PurchaseAuthorizationRequested(mandateId, intentHash, authorizationId);
    }
}
