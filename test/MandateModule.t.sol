// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BuyerCheckoutCoordinator} from "../contracts/BuyerCheckoutCoordinator.sol";
import {IMandateModule} from "../contracts/mandates/IMandateModule.sol";
import {MandateModule} from "../contracts/mandates/MandateModule.sol";
import {MandateTypes} from "../contracts/mandates/MandateTypes.sol";

/// @dev Minimal Foundry cheatcode interface. No forge-std dependency is required.
interface Vm {
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 revertData) external;
}

contract MandateModuleTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant AGENT = address(0xA6E17);
    address private constant OTHER_AGENT = address(0xBAD);
    address private constant POLICY_ENGINE = address(0xB0B);
    address private constant PAYMENT_ADAPTER = address(0xCAFE);

    MandateModule private mandateModule;
    BuyerCheckoutCoordinator private coordinator;

    function setUp() public {
        mandateModule = new MandateModule();
        coordinator = new BuyerCheckoutCoordinator(IMandateModule(address(mandateModule)), POLICY_ENGINE);
        mandateModule.setCoordinator(address(coordinator));
    }

    function testCreatesAnActiveMandate() public {
        bytes32 mandateId = _createMandate();

        MandateTypes.Mandate memory mandate = mandateModule.getMandate(mandateId);
        require(mandate.owner == OWNER, "owner was not stored");
        require(mandate.revision == 1, "initial revision is incorrect");
        require(mandateModule.isUsable(mandateId, AGENT), "active mandate should be usable");
        require(!mandateModule.isUsable(mandateId, OTHER_AGENT), "wrong agent must not be usable");
    }

    function testOnlyTheBoundAgentCanReserveAuthorization() public {
        bytes32 mandateId = _createMandate();

        vm.startPrank(POLICY_ENGINE);
        vm.expectRevert(MandateModule.UnauthorizedAgent.selector);
        coordinator.reservePaymentAuthorization(
            mandateId,
            OTHER_AGENT,
            PAYMENT_ADAPTER,
            120,
            0,
            keccak256("wrong-agent-intent"),
            uint64(block.timestamp + 1 hours)
        );
        vm.stopPrank();
    }

    function testRejectsAnOrderOverThePerOperationLimit() public {
        bytes32 mandateId = _createMandate();

        vm.startPrank(POLICY_ENGINE);
        vm.expectRevert(MandateModule.AmountExceedsLimit.selector);
        coordinator.reservePaymentAuthorization(
            mandateId,
            AGENT,
            PAYMENT_ADAPTER,
            251,
            0,
            keccak256("over-limit-intent"),
            uint64(block.timestamp + 1 hours)
        );
        vm.stopPrank();
    }

    function testReservesAndConsumesAuthorizationOnlyOnce() public {
        bytes32 mandateId = _createMandate();
        bytes32 authorizationId = _reserve(mandateId, 120, keccak256("monthly-box-order"));

        MandateTypes.Mandate memory reservedMandate = mandateModule.getMandate(mandateId);
        require(reservedMandate.reserved == 120, "reservation was not recorded");
        require(reservedMandate.spent == 0, "reservation must not count as spent");

        vm.prank(PAYMENT_ADAPTER);
        mandateModule.consumeAuthorization(authorizationId);

        MandateTypes.Mandate memory consumedMandate = mandateModule.getMandate(mandateId);
        require(consumedMandate.reserved == 0, "reservation was not released");
        require(consumedMandate.spent == 120, "consumption was not recorded");

        vm.prank(PAYMENT_ADAPTER);
        vm.expectRevert(MandateModule.AuthorizationNotActive.selector);
        mandateModule.consumeAuthorization(authorizationId);
    }

    function testRevocationBlocksNewAuthorizations() public {
        bytes32 mandateId = _createMandate();

        vm.prank(OWNER);
        mandateModule.revokeMandate(mandateId);
        require(!mandateModule.isUsable(mandateId, AGENT), "revoked mandate must not be usable");

        vm.startPrank(POLICY_ENGINE);
        vm.expectRevert(MandateModule.MandateNotUsable.selector);
        coordinator.reservePaymentAuthorization(
            mandateId,
            AGENT,
            PAYMENT_ADAPTER,
            120,
            0,
            keccak256("revoked-mandate-intent"),
            uint64(block.timestamp + 1 hours)
        );
        vm.stopPrank();
    }

    function testExpiryBlocksAuthorizations() public {
        MandateTypes.Terms memory terms = _terms(uint64(block.timestamp + 1 hours));
        vm.prank(OWNER);
        bytes32 mandateId = mandateModule.createMandate(terms);

        vm.warp(terms.expiresAt);
        require(!mandateModule.isUsable(mandateId, AGENT), "expired mandate must not be usable");

        vm.startPrank(POLICY_ENGINE);
        vm.expectRevert(MandateModule.MandateNotUsable.selector);
        coordinator.reservePaymentAuthorization(
            mandateId,
            AGENT,
            PAYMENT_ADAPTER,
            120,
            0,
            keccak256("expired-mandate-intent"),
            uint64(block.timestamp + 1)
        );
        vm.stopPrank();
    }

    function testAmendmentInvalidatesEarlierAuthorization() public {
        bytes32 mandateId = _createMandate();
        bytes32 authorizationId = _reserve(mandateId, 120, keccak256("pre-amendment-intent"));

        MandateTypes.Terms memory amendedTerms = _terms(uint64(block.timestamp + 30 days));
        amendedTerms.maxTotal = 650;
        vm.prank(OWNER);
        mandateModule.amendMandate(mandateId, amendedTerms);

        vm.prank(PAYMENT_ADAPTER);
        vm.expectRevert(MandateModule.MandateChanged.selector);
        mandateModule.consumeAuthorization(authorizationId);
    }

    function _createMandate() private returns (bytes32 mandateId) {
        vm.prank(OWNER);
        mandateId = mandateModule.createMandate(_terms(uint64(block.timestamp + 30 days)));
    }

    function _reserve(bytes32 mandateId, uint128 amount, bytes32 intentHash) private returns (bytes32 authorizationId) {
        vm.prank(POLICY_ENGINE);
        authorizationId = coordinator.reservePaymentAuthorization(
            mandateId,
            AGENT,
            PAYMENT_ADAPTER,
            amount,
            0,
            intentHash,
            uint64(block.timestamp + 1 hours)
        );
    }

    function _terms(uint64 expiresAt) private view returns (MandateTypes.Terms memory) {
        return MandateTypes.Terms({
            agent: AGENT,
            paymentDelegate: PAYMENT_ADAPTER,
            validAfter: uint64(block.timestamp),
            expiresAt: expiresAt,
            maxPerOperation: 250,
            maxTotal: 500,
            allowedActions: 1,
            policyHash: keccak256("packaging-replenishment-policy-v1")
        });
    }
}
