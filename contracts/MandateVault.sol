// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title MandateVault
/// @notice Escrows an owner's tokens and lets a named agent reserve only the purchases
///         allowed by a static mandate. The approved merchant captures a reservation.
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

    IERC20 public immutable paymentToken;
    uint256 public nextMandateId = 1;

    mapping(uint256 mandateId => Mandate mandate) public mandates;
    mapping(bytes32 purchaseId => Purchase purchase) public purchases;

    uint256 private _entered;

    event MandateCreated(
        uint256 indexed mandateId,
        address indexed owner,
        address indexed agent,
        address merchant,
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
    event AvailableFundsWithdrawn(uint256 indexed mandateId, address indexed owner, uint256 amount);

    modifier nonReentrant() {
        require(_entered == 0, "REENTRANCY");
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(IERC20 paymentToken_) {
        require(address(paymentToken_) != address(0), "ZERO_TOKEN");
        paymentToken = paymentToken_;
    }

    /// @notice Creates and funds a fixed mandate in one transaction.
    /// @param budget Token amount escrowed for this mandate (6 decimals for MockUSDC).
    function createMandate(
        address agent,
        address merchant,
        bytes32 productHash,
        uint256 quantity,
        uint256 maxUnitPrice,
        uint256 budget,
        uint64 expiresAt
    ) external nonReentrant returns (uint256 mandateId) {
        require(agent != address(0) && merchant != address(0), "ZERO_PARTY");
        require(productHash != bytes32(0), "ZERO_PRODUCT");
        require(quantity > 0 && maxUnitPrice > 0 && budget > 0, "INVALID_LIMIT");
        require(expiresAt > block.timestamp, "INVALID_EXPIRY");

        // The funded budget must cover buying the full mandated quantity at its price cap.
        require(budget >= quantity * maxUnitPrice, "BUDGET_BELOW_CAP");

        mandateId = nextMandateId++;
        mandates[mandateId] = Mandate({
            owner: msg.sender,
            agent: agent,
            merchant: merchant,
            productHash: productHash,
            remainingQuantity: quantity,
            maxUnitPrice: maxUnitPrice,
            remainingBudget: budget,
            expiresAt: expiresAt,
            status: MandateStatus.Active
        });

        require(paymentToken.transferFrom(msg.sender, address(this), budget), "FUNDING_FAILED");
        emit MandateCreated(mandateId, msg.sender, agent, merchant, productHash, quantity, maxUnitPrice, budget, expiresAt);
    }

    /// @notice Lets the authorized agent lock funds for one exact order.
    /// @dev `orderId` is an off-chain order identifier hashed by the caller. It may only be used once per mandate.
    function reservePurchase(
        uint256 mandateId,
        bytes32 orderId,
        uint256 quantity,
        uint256 unitPrice
    ) external returns (bytes32 purchaseId) {
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

        mandate.remainingQuantity -= quantity;
        mandate.remainingBudget -= amount;
        purchases[purchaseId] = Purchase({
            mandateId: mandateId,
            quantity: quantity,
            unitPrice: unitPrice,
            amount: amount,
            status: PurchaseStatus.Reserved
        });

        emit PurchaseReserved(purchaseId, mandateId, orderId, quantity, unitPrice, amount);
    }

    /// @notice Captures a reserved purchase and transfers escrowed tokens to the approved merchant.
    /// @dev A revoked or expired mandate cannot capture an unused reservation.
    function settlePurchase(bytes32 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        Mandate storage mandate = mandates[purchase.mandateId];
        require(msg.sender == mandate.merchant, "NOT_MERCHANT");
        require(purchase.status == PurchaseStatus.Reserved, "PURCHASE_NOT_RESERVED");
        require(_isActive(mandate), "MANDATE_INACTIVE");

        purchase.status = PurchaseStatus.Settled;
        require(paymentToken.transfer(mandate.merchant, purchase.amount), "SETTLEMENT_FAILED");
        emit PurchaseSettled(purchaseId, purchase.mandateId, mandate.merchant, purchase.amount);
    }

    /// @notice Cancels an unused reservation and returns its capacity to the mandate.
    function releasePurchase(bytes32 purchaseId) external {
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
        emit PurchaseReleased(purchaseId, purchase.mandateId, purchase.amount);
    }

    /// @notice Immediately prevents new reservations and settlement of unused reservations.
    function revokeMandate(uint256 mandateId) external {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.owner, "NOT_OWNER");
        require(mandate.status == MandateStatus.Active, "MANDATE_NOT_ACTIVE");

        mandate.status = MandateStatus.Revoked;
        emit MandateRevoked(mandateId);
    }

    /// @notice Recovers unreserved funds after revocation or expiry.
    /// @dev Reserved purchases must be settled or released separately.
    function withdrawAvailableFunds(uint256 mandateId) external nonReentrant {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.owner, "NOT_OWNER");
        require(mandate.status == MandateStatus.Revoked || block.timestamp >= mandate.expiresAt, "MANDATE_STILL_ACTIVE");

        uint256 amount = mandate.remainingBudget;
        require(amount > 0, "NO_AVAILABLE_FUNDS");
        mandate.remainingBudget = 0;

        require(paymentToken.transfer(mandate.owner, amount), "WITHDRAWAL_FAILED");
        emit AvailableFundsWithdrawn(mandateId, mandate.owner, amount);
    }

    function isMandateActive(uint256 mandateId) external view returns (bool) {
        return _isActive(mandates[mandateId]);
    }

    function _isActive(Mandate storage mandate) private view returns (bool) {
        return mandate.status == MandateStatus.Active && block.timestamp < mandate.expiresAt;
    }
}
