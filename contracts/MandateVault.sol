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
        bytes32 kycCredentialHash;
        bytes32 productHash;
        uint256 remainingQuantity;
        uint256 maxUnitPrice;
        uint256 remainingBudget;
        uint64 expiresAt;
        uint64 revision;
        MandateStatus status;
    }

    struct Purchase {
        uint256 mandateId;
        address merchant;
        bytes32 checkoutHash;
        bytes32 orderId;
        uint256 quantity;
        uint256 unitPrice;
        uint256 amount;
        uint64 checkoutExpiresAt;
        uint64 mandateRevision;
        PurchaseStatus status;
    }

    IMockCardProcessor public immutable cardProcessor;
    uint256 public nextMandateId = 1;

    mapping(uint256 mandateId => Mandate mandate) public mandates;
    mapping(bytes32 purchaseId => Purchase purchase) public purchases;
    /// @notice Sellers the buyer explicitly permitted the agent to compare for a mandate.
    mapping(uint256 mandateId => mapping(address merchant => bool)) public merchantAllowed;

    uint256 private _entered;

    event MandateCreated(
        uint256 indexed mandateId,
        address indexed owner,
        address indexed agent,
        address merchant,
        bytes32 paymentMethodId,
        bytes32 kycCredentialHash,
        bytes32 productHash,
        uint256 quantity,
        uint256 maxUnitPrice,
        uint256 budget,
        uint64 expiresAt
    );
    event PurchaseAuthorized(
        bytes32 indexed purchaseId,
        uint256 indexed mandateId,
        bytes32 indexed checkoutHash,
        bytes32 orderId,
        uint256 quantity,
        uint256 unitPrice,
        uint256 amount
    );
    event PurchaseSettled(bytes32 indexed purchaseId, uint256 indexed mandateId, address indexed merchant, uint256 amount);
    event PurchaseReleased(bytes32 indexed purchaseId, uint256 indexed mandateId, uint256 amount);
    event MandatePriceCapAmended(uint256 indexed mandateId, uint64 indexed revision, uint256 previousMaxUnitPrice, uint256 newMaxUnitPrice);
    event MandateRevoked(uint256 indexed mandateId);
    event MarketplaceMandateCreated(uint256 indexed mandateId, uint256 merchantCount);

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

    /// @notice Creates a static mandate after the buyer has completed KYC/login payment enrollment.
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
        require(cardProcessor.isVerifiedPaymentMethod(msg.sender, paymentMethodId), "UNVERIFIED_PAYMENT_METHOD");
        require(quantity > 0 && maxUnitPrice > 0 && budget > 0, "INVALID_LIMIT");
        require(expiresAt > block.timestamp, "INVALID_EXPIRY");
        require(budget >= quantity * maxUnitPrice, "BUDGET_BELOW_CAP");

        mandateId = nextMandateId++;
        mandates[mandateId] = Mandate({
            owner: msg.sender,
            agent: agent,
            merchant: merchant,
            paymentMethodId: paymentMethodId,
            kycCredentialHash: cardProcessor.kycCredentialHash(paymentMethodId),
            productHash: productHash,
            remainingQuantity: quantity,
            maxUnitPrice: maxUnitPrice,
            remainingBudget: budget,
            expiresAt: expiresAt,
            revision: 1,
            status: MandateStatus.Active
        });

        emit MandateCreated(
            mandateId,
            msg.sender,
            agent,
            merchant,
            paymentMethodId,
            cardProcessor.kycCredentialHash(paymentMethodId),
            productHash,
            quantity,
            maxUnitPrice,
            budget,
            expiresAt
        );
        merchantAllowed[mandateId][merchant] = true;
    }

    /// @notice Creates a mandate that lets the delegated agent choose among explicitly approved sellers.
    /// @dev Each eventual checkout is still signed by, authorized for, and captured only by the chosen seller.
    function createMarketplaceMandate(
        address agent,
        address[] calldata merchants,
        bytes32 paymentMethodId,
        bytes32 productHash,
        uint256 quantity,
        uint256 maxUnitPrice,
        uint256 budget,
        uint64 expiresAt
    ) external returns (uint256 mandateId) {
        require(merchants.length > 0, "NO_MERCHANTS");
        require(agent != address(0) && merchants[0] != address(0), "ZERO_PARTY");
        require(paymentMethodId != bytes32(0) && productHash != bytes32(0), "MISSING_REFERENCE");
        require(cardProcessor.isVerifiedPaymentMethod(msg.sender, paymentMethodId), "UNVERIFIED_PAYMENT_METHOD");
        require(quantity > 0 && maxUnitPrice > 0 && budget > 0, "INVALID_LIMIT");
        require(expiresAt > block.timestamp, "INVALID_EXPIRY");
        require(budget >= quantity * maxUnitPrice, "BUDGET_BELOW_CAP");

        mandateId = nextMandateId++;
        mandates[mandateId] = Mandate({
            owner: msg.sender,
            agent: agent,
            // Kept as the primary merchant for backwards-compatible reads. Marketplace
            // purchases carry their selected merchant individually.
            merchant: merchants[0],
            paymentMethodId: paymentMethodId,
            kycCredentialHash: cardProcessor.kycCredentialHash(paymentMethodId),
            productHash: productHash,
            remainingQuantity: quantity,
            maxUnitPrice: maxUnitPrice,
            remainingBudget: budget,
            expiresAt: expiresAt,
            revision: 1,
            status: MandateStatus.Active
        });

        for (uint256 i = 0; i < merchants.length; i++) {
            require(merchants[i] != address(0), "ZERO_PARTY");
            merchantAllowed[mandateId][merchants[i]] = true;
        }

        emit MandateCreated(
            mandateId,
            msg.sender,
            agent,
            merchants[0],
            paymentMethodId,
            cardProcessor.kycCredentialHash(paymentMethodId),
            productHash,
            quantity,
            maxUnitPrice,
            budget,
            expiresAt
        );
        emit MarketplaceMandateCreated(mandateId, merchants.length);
    }

    /// @notice Binds the agent's purchase to a merchant-signed checkout and issues a one-use authorization.
    /// @dev No funds move here. The buyer's KYC-linked payment method is charged only during merchant capture.
    function reservePurchase(
        uint256 mandateId,
        bytes32 orderId,
        uint64 checkoutExpiresAt,
        uint256 quantity,
        uint256 unitPrice,
        bytes calldata merchantSignature
    ) external nonReentrant returns (bytes32 purchaseId) {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.agent, "NOT_AGENT");
        require(_isActive(mandate), "MANDATE_INACTIVE");
        require(orderId != bytes32(0) && quantity > 0, "INVALID_PURCHASE");
        require(checkoutExpiresAt >= block.timestamp && checkoutExpiresAt <= mandate.expiresAt, "CHECKOUT_EXPIRED");
        require(quantity <= mandate.remainingQuantity, "QUANTITY_EXCEEDED");
        require(unitPrice <= mandate.maxUnitPrice, "PRICE_EXCEEDED");

        uint256 amount = quantity * unitPrice;
        require(amount <= mandate.remainingBudget, "BUDGET_EXCEEDED");

        bytes32 checkoutHash = checkoutHashFor(mandateId, orderId, checkoutExpiresAt, quantity, unitPrice);
        require(_merchantSignedCheckout(checkoutHash, merchantSignature, mandate.merchant), "INVALID_MERCHANT_QUOTE");

        purchaseId = keccak256(abi.encode(mandateId, checkoutHash));
        require(purchases[purchaseId].status == PurchaseStatus.None, "ORDER_ALREADY_USED");

        mandate.remainingQuantity -= quantity;
        mandate.remainingBudget -= amount;
        purchases[purchaseId] = Purchase({
            mandateId: mandateId,
            merchant: mandate.merchant,
            checkoutHash: checkoutHash,
            orderId: orderId,
            quantity: quantity,
            unitPrice: unitPrice,
            amount: amount,
            checkoutExpiresAt: checkoutExpiresAt,
            mandateRevision: mandate.revision,
            status: PurchaseStatus.Reserved
        });
        cardProcessor.issueVirtualCardAuthorization(
            purchaseId,
            mandate.owner,
            mandate.paymentMethodId,
            mandate.merchant,
            amount
        );

        emit PurchaseAuthorized(purchaseId, mandateId, checkoutHash, orderId, quantity, unitPrice, amount);
    }

    /// @notice Binds a purchase to one of the mandate's approved merchants after comparing their signed quotes.
    function reserveMarketplacePurchase(
        uint256 mandateId,
        address merchant,
        bytes32 orderId,
        uint64 checkoutExpiresAt,
        uint256 quantity,
        uint256 unitPrice,
        bytes calldata merchantSignature
    ) external nonReentrant returns (bytes32 purchaseId) {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.agent, "NOT_AGENT");
        require(_isActive(mandate), "MANDATE_INACTIVE");
        require(merchantAllowed[mandateId][merchant], "MERCHANT_NOT_ALLOWED");
        require(orderId != bytes32(0) && quantity > 0, "INVALID_PURCHASE");
        require(checkoutExpiresAt >= block.timestamp && checkoutExpiresAt <= mandate.expiresAt, "CHECKOUT_EXPIRED");
        require(quantity <= mandate.remainingQuantity, "QUANTITY_EXCEEDED");
        require(unitPrice <= mandate.maxUnitPrice, "PRICE_EXCEEDED");

        uint256 amount = quantity * unitPrice;
        require(amount <= mandate.remainingBudget, "BUDGET_EXCEEDED");

        bytes32 checkoutHash = marketplaceCheckoutHashFor(
            mandateId, merchant, orderId, checkoutExpiresAt, quantity, unitPrice
        );
        require(_merchantSignedCheckout(checkoutHash, merchantSignature, merchant), "INVALID_MERCHANT_QUOTE");

        purchaseId = keccak256(abi.encode(mandateId, checkoutHash));
        require(purchases[purchaseId].status == PurchaseStatus.None, "ORDER_ALREADY_USED");

        mandate.remainingQuantity -= quantity;
        mandate.remainingBudget -= amount;
        purchases[purchaseId] = Purchase({
            mandateId: mandateId,
            merchant: merchant,
            checkoutHash: checkoutHash,
            orderId: orderId,
            quantity: quantity,
            unitPrice: unitPrice,
            amount: amount,
            checkoutExpiresAt: checkoutExpiresAt,
            mandateRevision: mandate.revision,
            status: PurchaseStatus.Reserved
        });
        cardProcessor.issueVirtualCardAuthorization(
            purchaseId,
            mandate.owner,
            mandate.paymentMethodId,
            merchant,
            amount
        );

        emit PurchaseAuthorized(purchaseId, mandateId, checkoutHash, orderId, quantity, unitPrice, amount);
    }

    /// @notice Lets the approved merchant capture its one-use virtual card and receive USD.
    /// @dev A revoked or expired mandate cannot settle an unused authorization.
    function settlePurchase(bytes32 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        Mandate storage mandate = mandates[purchase.mandateId];
        address merchant = purchase.merchant;
        require(msg.sender == merchant, "NOT_MERCHANT");
        require(purchase.status == PurchaseStatus.Reserved, "PURCHASE_NOT_RESERVED");
        require(_isActive(mandate), "MANDATE_INACTIVE");
        require(purchase.mandateRevision == mandate.revision, "MANDATE_AMENDED");
        require(block.timestamp <= purchase.checkoutExpiresAt, "CHECKOUT_EXPIRED");

        cardProcessor.captureVirtualCard(purchaseId, merchant);
        purchase.status = PurchaseStatus.Settled;
        emit PurchaseSettled(purchaseId, purchase.mandateId, merchant, purchase.amount);
    }

    /// @notice Cancels an unused authorization and restores mandate capacity. No refund is required.
    function releasePurchase(bytes32 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        Mandate storage mandate = mandates[purchase.mandateId];
        require(purchase.status == PurchaseStatus.Reserved, "PURCHASE_NOT_RESERVED");
        require(
            msg.sender == mandate.owner || msg.sender == mandate.agent || msg.sender == purchase.merchant,
            "NOT_PARTY"
        );

        purchase.status = PurchaseStatus.Released;
        mandate.remainingQuantity += purchase.quantity;
        mandate.remainingBudget += purchase.amount;
        cardProcessor.voidUncapturedVirtualCard(purchaseId);
        emit PurchaseReleased(purchaseId, purchase.mandateId, purchase.amount);
    }

    /// @notice Lets the owner lower or raise the price cap without recreating the mandate.
    /// @dev A revision change prevents capture of every unused virtual card issued under earlier terms.
    function amendMaxUnitPrice(uint256 mandateId, uint256 newMaxUnitPrice) external {
        Mandate storage mandate = mandates[mandateId];
        require(msg.sender == mandate.owner, "NOT_OWNER");
        require(_isActive(mandate), "MANDATE_INACTIVE");
        require(newMaxUnitPrice > 0, "INVALID_LIMIT");

        uint256 previousMaxUnitPrice = mandate.maxUnitPrice;
        require(newMaxUnitPrice != previousMaxUnitPrice, "UNCHANGED_LIMIT");
        mandate.maxUnitPrice = newMaxUnitPrice;
        unchecked {
            mandate.revision++;
        }

        emit MandatePriceCapAmended(mandateId, mandate.revision, previousMaxUnitPrice, newMaxUnitPrice);
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

    /// @notice The canonical merchant checkout digest the agent must present with the merchant's signature.
    /// @dev Includes chain and contract domains so a quote cannot be replayed across deployments or chains.
    function checkoutHashFor(
        uint256 mandateId,
        bytes32 orderId,
        uint64 checkoutExpiresAt,
        uint256 quantity,
        uint256 unitPrice
    ) public view returns (bytes32) {
        Mandate storage mandate = mandates[mandateId];
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                mandateId,
                mandate.merchant,
                mandate.productHash,
                orderId,
                checkoutExpiresAt,
                quantity,
                unitPrice
            )
        );
    }

    /// @notice Canonical checkout digest for a quote from one merchant in a marketplace mandate.
    function marketplaceCheckoutHashFor(
        uint256 mandateId,
        address merchant,
        bytes32 orderId,
        uint64 checkoutExpiresAt,
        uint256 quantity,
        uint256 unitPrice
    ) public view returns (bytes32) {
        Mandate storage mandate = mandates[mandateId];
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                mandateId,
                merchant,
                mandate.productHash,
                orderId,
                checkoutExpiresAt,
                quantity,
                unitPrice
            )
        );
    }

    function isMerchantAllowed(uint256 mandateId, address merchant) external view returns (bool) {
        return merchantAllowed[mandateId][merchant];
    }

    function _merchantSignedCheckout(
        bytes32 checkoutHash,
        bytes calldata signature,
        address merchant
    ) private pure returns (bool) {
        if (signature.length != 65) return false;

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return false;

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", checkoutHash));
        return ecrecover(ethSignedHash, v, r, s) == merchant;
    }

    function _isActive(Mandate storage mandate) private view returns (bool) {
        return mandate.status == MandateStatus.Active && block.timestamp < mandate.expiresAt;
    }
}
