// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IMockCardProcessor} from "./interfaces/IMockCardProcessor.sol";

/// @notice Test-only stand-in for a KYC credential provider plus virtual-card issuer.
/// @dev In production this behavior belongs to regulated, off-chain payment partners.
contract MockCardProcessor is IMockCardProcessor {
    enum VirtualCardStatus {
        None,
        Authorized,
        Captured,
        Voided
    }

    struct PaymentMethod {
        address owner;
        bytes32 kycCredential;
        bool active;
    }

    struct VirtualCard {
        address buyer;
        address merchant;
        bytes32 paymentMethodId;
        uint256 amount;
        VirtualCardStatus status;
    }

    IERC20 public immutable usd;
    address public immutable admin;
    address public vault;

    mapping(bytes32 paymentMethodId => PaymentMethod paymentMethod) public paymentMethods;
    mapping(bytes32 purchaseId => VirtualCard virtualCard) public virtualCards;

    event KycPaymentMethodEnrolled(
        bytes32 indexed paymentMethodId,
        address indexed owner,
        bytes32 indexed kycCredential
    );
    event BuyerCharged(bytes32 indexed purchaseId, bytes32 indexed paymentMethodId, address indexed buyer, uint256 amount);
    event VirtualCardIssued(bytes32 indexed purchaseId, address indexed merchant, uint256 amount);
    event VirtualCardCaptured(bytes32 indexed purchaseId, address indexed merchant, uint256 amount);
    event VirtualCardVoided(bytes32 indexed purchaseId, address indexed buyer, uint256 amount);

    modifier onlyVault() {
        require(msg.sender == vault, "NOT_VAULT");
        _;
    }

    constructor(IERC20 usd_) {
        require(address(usd_) != address(0), "ZERO_USD");
        usd = usd_;
        admin = msg.sender;
    }

    /// @notice Binds the processor to the vault once, as an issuer integration would be configured.
    function setVault(address vault_) external {
        require(msg.sender == admin, "NOT_ADMIN");
        require(vault == address(0) && vault_ != address(0), "VAULT_ALREADY_SET");
        vault = vault_;
    }

    /// @notice Simulates KYC/login plus payment-token enrollment. No raw card data or money moves on-chain.
    /// @dev `admin` represents the regulated credential provider in this mock.
    function registerVerifiedPaymentMethod(
        bytes32 paymentMethodId,
        address buyer,
        bytes32 kycCredential
    ) external {
        require(msg.sender == admin, "NOT_CREDENTIAL_PROVIDER");
        require(paymentMethodId != bytes32(0), "ZERO_PAYMENT_METHOD");
        require(buyer != address(0) && kycCredential != bytes32(0), "MISSING_KYC_BINDING");
        require(paymentMethods[paymentMethodId].owner == address(0), "PAYMENT_METHOD_EXISTS");
        paymentMethods[paymentMethodId] = PaymentMethod({owner: buyer, kycCredential: kycCredential, active: true});
        emit KycPaymentMethodEnrolled(paymentMethodId, buyer, kycCredential);
    }

    function isVerifiedPaymentMethod(address buyer, bytes32 paymentMethodId) external view returns (bool) {
        PaymentMethod memory paymentMethod = paymentMethods[paymentMethodId];
        return paymentMethod.active && paymentMethod.owner == buyer;
    }

    function kycCredentialHash(bytes32 paymentMethodId) external view returns (bytes32) {
        return paymentMethods[paymentMethodId].kycCredential;
    }

    /// @notice Issues a single-use virtual payment authorization for the exact merchant and amount.
    /// @dev This is deliberately not a charge or a hold. Money moves only during capture.
    function issueVirtualCardAuthorization(
        bytes32 purchaseId,
        address buyer,
        bytes32 paymentMethodId,
        address merchant,
        uint256 amount
    ) external onlyVault {
        PaymentMethod memory paymentMethod = paymentMethods[paymentMethodId];
        require(paymentMethod.active && paymentMethod.owner == buyer, "INVALID_PAYMENT_METHOD");
        require(virtualCards[purchaseId].status == VirtualCardStatus.None, "VIRTUAL_CARD_EXISTS");

        virtualCards[purchaseId] = VirtualCard({
            buyer: buyer,
            merchant: merchant,
            paymentMethodId: paymentMethodId,
            amount: amount,
            status: VirtualCardStatus.Authorized
        });

        emit VirtualCardIssued(purchaseId, merchant, amount);
    }

    /// @notice Pulls from the buyer's enrolled payment method and pays the seller atomically on capture.
    function captureVirtualCard(bytes32 purchaseId, address merchant) external onlyVault {
        VirtualCard storage virtualCard = virtualCards[purchaseId];
        require(virtualCard.status == VirtualCardStatus.Authorized, "CARD_NOT_AUTHORIZED");
        require(virtualCard.merchant == merchant, "WRONG_MERCHANT");

        // If the saved method is declined (no balance/consent), the entire capture reverts.
        // The merchant receives nothing and the authorization remains available to release or retry.
        require(usd.transferFrom(virtualCard.buyer, merchant, virtualCard.amount), "BUYER_CHARGE_FAILED");
        virtualCard.status = VirtualCardStatus.Captured;
        emit BuyerCharged(purchaseId, virtualCard.paymentMethodId, virtualCard.buyer, virtualCard.amount);
        emit VirtualCardCaptured(purchaseId, merchant, virtualCard.amount);
    }

    /// @notice Cancels an unused authorization. Since it was never captured, no refund occurs.
    function voidUncapturedVirtualCard(bytes32 purchaseId) external onlyVault {
        VirtualCard storage virtualCard = virtualCards[purchaseId];
        require(virtualCard.status == VirtualCardStatus.Authorized, "CARD_NOT_AUTHORIZED");

        virtualCard.status = VirtualCardStatus.Voided;
        emit VirtualCardVoided(purchaseId, virtualCard.buyer, virtualCard.amount);
    }
}
