// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test-only interface for the KYC-linked card-on-file and virtual-card payment adapter.
interface IMockCardProcessor {
    /// @notice True only for an active, tokenized payment method enrolled by the credential provider.
    function isVerifiedPaymentMethod(address buyer, bytes32 paymentMethodId) external view returns (bool);

    /// @notice Returns the privacy-safe reference to the buyer's KYC/login credential.
    function kycCredentialHash(bytes32 paymentMethodId) external view returns (bytes32);

    /// @notice Creates a merchant-scoped payment authorization. No funds move at this point.
    function issueVirtualCardAuthorization(
        bytes32 purchaseId,
        address buyer,
        bytes32 paymentMethodId,
        address merchant,
        uint256 amount
    ) external;

    function captureVirtualCard(bytes32 purchaseId, address merchant) external;

    /// @notice Cancels an unused authorization. No refund is needed because capture never occurred.
    function voidUncapturedVirtualCard(bytes32 purchaseId) external;
}
