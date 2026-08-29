// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MandateTypes} from "./MandateTypes.sol";

/// @notice Stable boundary used by the purchase program and payment adapter.
/// @dev Callers depend on this interface, never on the module's storage layout.
interface IMandateModule {
    event MandateCreated(bytes32 indexed mandateId, address indexed owner, address indexed agent, bytes32 policyHash, uint64 expiresAt);
    event MandateAmended(bytes32 indexed mandateId, uint64 revision, bytes32 policyHash, uint64 expiresAt);
    event MandateRevoked(bytes32 indexed mandateId, address indexed owner);
    event AuthorizationReserved(bytes32 indexed authorizationId, bytes32 indexed mandateId, bytes32 indexed intentHash, uint128 amount, uint64 expiresAt);
    event AuthorizationConsumed(bytes32 indexed authorizationId, bytes32 indexed mandateId, address indexed paymentDelegate);
    event AuthorizationCancelled(bytes32 indexed authorizationId, bytes32 indexed mandateId);

    function createMandate(MandateTypes.Terms calldata terms) external returns (bytes32 mandateId);
    function amendMandate(bytes32 mandateId, MandateTypes.Terms calldata terms) external;
    function revokeMandate(bytes32 mandateId) external;

    function isUsable(bytes32 mandateId, address agent) external view returns (bool);
    function getMandate(bytes32 mandateId) external view returns (MandateTypes.Mandate memory);
    function getAuthorization(bytes32 authorizationId) external view returns (MandateTypes.Authorization memory);

    /// @notice Reserves budget and creates a one-time authorization for a validated intent.
    function reserveAuthorization(
        bytes32 mandateId,
        address agent,
        address paymentDelegate,
        uint128 amount,
        uint8 action,
        bytes32 intentHash,
        uint64 authorizationExpiresAt
    ) external returns (bytes32 authorizationId);

    /// @notice Consumes a reservation only while its underlying mandate is still usable.
    function consumeAuthorization(bytes32 authorizationId) external;
    function cancelAuthorization(bytes32 authorizationId) external;
    function releaseExpiredAuthorization(bytes32 authorizationId) external;
}
