// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMockCardProcessor} from "./interfaces/IMockCardProcessor.sol";

/// @title MandateVault
/// @notice Enforces static purchase mandates and delegates mock USD movement to a card processor.
/// @dev Despite its name, this version does not custody buyer funds. It is the on-chain
///      authorization ledger; `MockCardProcessor` simulates the off-chain payment adapter.
contract MandateVault {
    enum MandateStatus {
        None,
        Active,
        Revoked
    }

    enum PurchaseStatus {
        None,
        Reserved,
        Settled,
        Released
    }

    struct Mandate {
        address owner;
        address agent;
        address merchant;
        bytes32 paymentMethodId;
        bytes32 productHash;
        uint256 remainingQuantity;
        uint256 maxUnitPrice;
        uint256 remainingBudget;
        uint64 expiresAt;
        MandateStatus status;
    }

    struct Purchase {
        uint256 mandateId;
        uint256 quantity;
        uint256 unitPrice;
        uint256 amount;
        PurchaseStatus status;
    }

    IMockCardProcessor public immutable cardProcessor;
    uint256 public nextMandateId = 1;

    mapping(uint256 mandateId => Mandate mandate) public mandates;
    mapping(bytes32 purchaseId => Purchase purchase) public purchases;

    uint256 private _entered;

    event MandateCreated(
        uint256 indexed mandateId,
        address indexed owner,
        address indexed agent,
        address merchant,
        bytes32 paymentMethodId,
        bytes32 productHash,
        uint256 quantity,
        uint256 maxUnitPrice,
        uint256 budget,
        uint64 expiresAt
    );
    event PurchaseReserved(
        bytes32 indexed purchaseId,
        uint256 indexed mandateId,
        bytes32 indexed orderId,
        uint256 quantity,
        uint256 unitPrice,
        uint256 amount
    );
    event PurchaseSettled(bytes32 indexed purchaseId, uint256 indexed mandateId, address indexed merchant, uint256 amount);
    event PurchaseReleased(bytes32 indexed purchaseId, uint256 indexed mandateId, uint256 amount);
    event MandateRevoked(uint256 indexed mandateId);

    modifier nonReentrant() {
        require(_entered == 0, "REENTRANCY");
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(IMockCardProcessor cardProcessor_) {
        require(address(cardProcessor_) != address(0), "ZERO_CARD_PROCESSOR");
        cardProcessor = cardProcessor_;
    }

    /// @notice Creates a static mandate. No buyer funds are locked at creation.
    /// @param budget Maximum spend authorized under this mandate, in USD cents/microunits.
    function createMandate(
        address agent,
        address merchant,
        bytes32 paymentMethodId,
        bytes32 productHash,
        uint256 quantity,
        uint256 maxUnitPrice,
        uint256 budget,
        uint64 expiresAt
    ) external returns (uint256 mandateId) {
        require(agent != address(0) && merchant != address(0), "ZERO_PARTY");
        require(paymentMethodId != bytes32(0) && productHash != bytes32(0), "MISSING_REFERENCE");
        require(quantity > 0 && maxUnitPrice > 0 && budget > 0, "INVALID_LIMIT");
        require(expiresAt > block.timestamp, "INVALID_EXPIRY");
        require(budget >= quantity * maxUnitPrice, "BUDGET_BELOW_CAP");

        mandateId = nextMandateId++;
        mandates[mandateId] = Mandate({
            owner: msg.sender,
            agent: agent,
            merchant: merchant,
            paymentMethodId: paymentMethodId,
            productHash: productHash,
            remainingQuantity: quantity,
            maxUnitPrice: maxUnitPrice,
            remainingBudget: budget,
            expiresAt: expiresAt,
            status: MandateStatus.Active
        });

        emit MandateCreated(
            mandateId,
            msg.sender,
            agent,
            merchant,
            paymentMethodId,
            productHash,
            quantity,
            maxUnitPrice,
            budget,
            expiresAt
        );
    }

    /// @notice Validates an agent purchase, charges the saved buyer credential, and issues a one-use virtual card.
    /// @dev If the buyer charge fails, this entire transaction reverts and mandate capacity is unchanged.
    function reservePurchase(
        uint256 mandateId,
        bytes32 orderId,
        uint256 quantity,
        uint256 unitPrice
    ) external nonReentrant returns (bytes32 purchaseId) {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.agent, "NOT_AGENT");
        require(_isActive(mandate), "MANDATE_INACTIVE");
        require(orderId != bytes32(0) && quantity > 0, "INVALID_PURCHASE");
        require(quantity <= mandate.remainingQuantity, "QUANTITY_EXCEEDED");
        require(unitPrice <= mandate.maxUnitPrice, "PRICE_EXCEEDED");

        uint256 amount = quantity * unitPrice;
        require(amount <= mandate.remainingBudget, "BUDGET_EXCEEDED");

        purchaseId = keccak256(abi.encode(mandateId, orderId));
        require(purchases[purchaseId].status == PurchaseStatus.None, "ORDER_ALREADY_USED");

        // A failed card-on-file charge reverts all of these state changes.
        mandate.remainingQuantity -= quantity;
        mandate.remainingBudget -= amount;
        purchases[purchaseId] = Purchase({
            mandateId: mandateId,
            quantity: quantity,
            unitPrice: unitPrice,
            amount: amount,
            status: PurchaseStatus.Reserved
        });
        cardProcessor.chargeAndIssueVirtualCard(
            purchaseId,
            mandate.owner,
            mandate.paymentMethodId,
            mandate.merchant,
            amount
        );

        emit PurchaseReserved(purchaseId, mandateId, orderId, quantity, unitPrice, amount);
    }

    /// @notice Lets the approved merchant capture its one-use virtual card and receive USD.
    /// @dev A revoked or expired mandate cannot settle an unused authorization.
    function settlePurchase(bytes32 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        Mandate storage mandate = mandates[purchase.mandateId];
        require(msg.sender == mandate.merchant, "NOT_MERCHANT");
        require(purchase.status == PurchaseStatus.Reserved, "PURCHASE_NOT_RESERVED");
        require(_isActive(mandate), "MANDATE_INACTIVE");

        purchase.status = PurchaseStatus.Settled;
        cardProcessor.captureVirtualCard(purchaseId, mandate.merchant);
        emit PurchaseSettled(purchaseId, purchase.mandateId, mandate.merchant, purchase.amount);
    }

    /// @notice Cancels an unused virtual card, refunds the buyer, and restores mandate capacity.
    function releasePurchase(bytes32 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        Mandate storage mandate = mandates[purchase.mandateId];
        require(purchase.status == PurchaseStatus.Reserved, "PURCHASE_NOT_RESERVED");
        require(
            msg.sender == mandate.owner || msg.sender == mandate.agent || msg.sender == mandate.merchant,
            "NOT_PARTY"
        );

        purchase.status = PurchaseStatus.Released;
        mandate.remainingQuantity += purchase.quantity;
        mandate.remainingBudget += purchase.amount;
        cardProcessor.refundUncapturedVirtualCard(purchaseId);
        emit PurchaseReleased(purchaseId, purchase.mandateId, purchase.amount);
    }

    /// @notice Immediately prevents new purchases and capture of unused virtual cards.
    function revokeMandate(uint256 mandateId) external {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.owner, "NOT_OWNER");
        require(mandate.status == MandateStatus.Active, "MANDATE_NOT_ACTIVE");

        mandate.status = MandateStatus.Revoked;
        emit MandateRevoked(mandateId);
    }

    function isMandateActive(uint256 mandateId) external view returns (bool) {
        return _isActive(mandates[mandateId]);
    }

    function _isActive(Mandate storage mandate) private view returns (bool) {
        return mandate.status == MandateStatus.Active && block.timestamp < mandate.expiresAt;
    }
}
