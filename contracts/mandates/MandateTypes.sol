// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Shared types for the Chk! Buyer mandate module.
/// @dev Monetary amounts use the smallest unit of the selected payment rail.
library MandateTypes {
    enum Status {
        None,
        Active,
        Revoked
    }

    struct Terms {
        address agent;
        // Settlement adapter allowed to consume an authorization for the selected rail.
        address paymentDelegate;
        uint64 validAfter;
        uint64 expiresAt;
        uint128 maxPerOperation;
        uint128 maxTotal;
        // Bitmask: action n is allowed when allowedActions & (1 << n) != 0.
        uint32 allowedActions;
        // Hash of the complete, versioned off-chain policy (merchant/category/conditions).
        bytes32 policyHash;
    }

    struct Mandate {
        address owner;
        Terms terms;
        Status status;
        uint64 revision;
        uint128 spent;
        uint128 reserved;
    }

    struct Authorization {
        bytes32 mandateId;
        uint128 amount;
        uint64 expiresAt;
        uint64 mandateRevision;
        bool active;
    }
}
