// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IMockCardProcessor} from "./interfaces/IMockCardProcessor.sol";

/// @notice Test-only stand-in for a payment provider plus virtual-card issuer.
/// @dev In production this behavior belongs to regulated, off-chain payment partners.
contract MockCardProcessor is IMockCardProcessor {
    enum VirtualCardStatus {
        None,
        Authorized,
        Captured,
        Refunded
    }

    struct PaymentMethod {
        address owner;
        bool active;
    }

    struct VirtualCard {
        address buyer;
        address merchant;
        uint256 amount;
        VirtualCardStatus status;
    }

    IERC20 public immutable usd;
    address public immutable admin;
    address public vault;

    mapping(bytes32 paymentMethodId => PaymentMethod paymentMethod) public paymentMethods;
    mapping(bytes32 purchaseId => VirtualCard virtualCard) public virtualCards;

    event PaymentMethodRegistered(bytes32 indexed paymentMethodId, address indexed owner);
    event BuyerCharged(bytes32 indexed purchaseId, bytes32 indexed paymentMethodId, address indexed buyer, uint256 amount);
    event VirtualCardIssued(bytes32 indexed purchaseId, address indexed merchant, uint256 amount);
    event VirtualCardCaptured(bytes32 indexed purchaseId, address indexed merchant, uint256 amount);
    event VirtualCardRefunded(bytes32 indexed purchaseId, address indexed buyer, uint256 amount);

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

    /// @notice Simulates tokenizing a buyer's card/bank credential. No money moves here.
    function registerPaymentMethod(bytes32 paymentMethodId) external {
        require(paymentMethodId != bytes32(0), "ZERO_PAYMENT_METHOD");
        require(paymentMethods[paymentMethodId].owner == address(0), "PAYMENT_METHOD_EXISTS");
        paymentMethods[paymentMethodId] = PaymentMethod({owner: msg.sender, active: true});
        emit PaymentMethodRegistered(paymentMethodId, msg.sender);
    }

    /// @notice Charges the buyer now and issues a single-use virtual card for the exact merchant and amount.
    function chargeAndIssueVirtualCard(
        bytes32 purchaseId,
        address buyer,
        bytes32 paymentMethodId,
        address merchant,
        uint256 amount
    ) external onlyVault {
        PaymentMethod memory paymentMethod = paymentMethods[paymentMethodId];
        require(paymentMethod.active && paymentMethod.owner == buyer, "INVALID_PAYMENT_METHOD");
        require(virtualCards[purchaseId].status == VirtualCardStatus.None, "VIRTUAL_CARD_EXISTS");

        require(usd.transferFrom(buyer, address(this), amount), "BUYER_CHARGE_FAILED");
        virtualCards[purchaseId] = VirtualCard({
            buyer: buyer,
            merchant: merchant,
            amount: amount,
            status: VirtualCardStatus.Authorized
        });

        emit BuyerCharged(purchaseId, paymentMethodId, buyer, amount);
        emit VirtualCardIssued(purchaseId, merchant, amount);
    }

    /// @notice Sends the charged USD to the seller when the seller captures its virtual card.
    function captureVirtualCard(bytes32 purchaseId, address merchant) external onlyVault {
        VirtualCard storage virtualCard = virtualCards[purchaseId];
        require(virtualCard.status == VirtualCardStatus.Authorized, "CARD_NOT_AUTHORIZED");
        require(virtualCard.merchant == merchant, "WRONG_MERCHANT");

        virtualCard.status = VirtualCardStatus.Captured;
        require(usd.transfer(merchant, virtualCard.amount), "CAPTURE_FAILED");
        emit VirtualCardCaptured(purchaseId, merchant, virtualCard.amount);
    }

    /// @notice Returns a charge to the buyer if the seller never captures the virtual card.
    function refundUncapturedVirtualCard(bytes32 purchaseId) external onlyVault {
        VirtualCard storage virtualCard = virtualCards[purchaseId];
        require(virtualCard.status == VirtualCardStatus.Authorized, "CARD_NOT_AUTHORIZED");

        virtualCard.status = VirtualCardStatus.Refunded;
        require(usd.transfer(virtualCard.buyer, virtualCard.amount), "REFUND_FAILED");
        emit VirtualCardRefunded(purchaseId, virtualCard.buyer, virtualCard.amount);
    }
}
