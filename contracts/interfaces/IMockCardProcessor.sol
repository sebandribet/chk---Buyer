// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test-only interface for the card-on-file and virtual-card payment adapter.
interface IMockCardProcessor {
    function chargeAndIssueVirtualCard(
        bytes32 purchaseId,
        address buyer,
        bytes32 paymentMethodId,
        address merchant,
        uint256 amount
    ) external;

    function captureVirtualCard(bytes32 purchaseId, address merchant) external;

    function refundUncapturedVirtualCard(bytes32 purchaseId) external;
}
