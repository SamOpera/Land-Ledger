const { expect } = require("chai");
const { ethers } = require("hardhat");

const plan = (n) => ethers.id(n); // keccak256 of the survey plan number
const docs = (s) => ethers.id(s);

describe("LandLedger", () => {
  let ledger, bureau, registrar, ada, bola, stranger;
  const PLAN = plan("LA/1234/2024");

  beforeEach(async () => {
    [bureau, registrar, ada, bola, stranger] = await ethers.getSigners();
    ledger = await ethers.deployContract("LandLedger");
    await ledger.setRegistrar(registrar.address, true);
    await ledger.approveSurveyPlan(PLAN);
  });

  const register = (owner = ada.address, p = PLAN) =>
    ledger.connect(registrar).registerParcel(owner, p, docs("deed.pdf"), "Plot 12, Lekki Phase 1, Lagos", 648);

  describe("roles", () => {
    it("only the bureau can appoint registrars", async () => {
      // v1 let anyone call this. A stranger must not be able to make themselves a registrar.
      await expect(ledger.connect(stranger).setRegistrar(stranger.address, true)).to.be.revertedWithCustomError(
        ledger,
        "NotBureau"
      );
      await expect(ledger.setRegistrar(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(ledger, "ZeroAddress");
    });

    it("only the bureau can approve survey plans, and each plan once", async () => {
      await expect(ledger.connect(registrar).approveSurveyPlan(plan("x"))).to.be.revertedWithCustomError(
        ledger,
        "NotBureau"
      );
      await expect(ledger.approveSurveyPlan(PLAN)).to.be.revertedWithCustomError(ledger, "PlanAlreadyKnown");
      await expect(ledger.approveSurveyPlan(ethers.ZeroHash)).to.be.revertedWithCustomError(ledger, "EmptyValue");
    });

    it("only registrars can register parcels", async () => {
      await expect(
        ledger.connect(stranger).registerParcel(ada.address, PLAN, docs("d"), "Somewhere", 100)
      ).to.be.revertedWithCustomError(ledger, "NotRegistrar");
    });

    it("a removed registrar loses access", async () => {
      await ledger.setRegistrar(registrar.address, false);
      await expect(register()).to.be.revertedWithCustomError(ledger, "NotRegistrar");
    });
  });

  describe("registration", () => {
    it("registers a parcel and records who owns it", async () => {
      await expect(register()).to.emit(ledger, "ParcelRegistered");
      const parcel = await ledger.getParcel(1);
      expect(parcel.owner).to.equal(ada.address);
      expect(parcel.areaSqm).to.equal(648);
      expect(await ledger.parcelOfPlan(PLAN)).to.equal(1);
      expect(await ledger.planStatus(PLAN)).to.equal(2); // Used
    });

    it("never registers the same survey plan twice", async () => {
      await register();
      await expect(register(bola.address)).to.be.revertedWithCustomError(ledger, "PlanNotApproved").withArgs(2);
    });

    it("refuses a survey plan the bureau never approved", async () => {
      await expect(register(ada.address, plan("FAKE/1"))).to.be.revertedWithCustomError(ledger, "PlanNotApproved").withArgs(0);
    });

    it("rejects empty details", async () => {
      await expect(
        ledger.connect(registrar).registerParcel(ada.address, PLAN, ethers.ZeroHash, "Plot 1", 100)
      ).to.be.revertedWithCustomError(ledger, "EmptyValue");
      await expect(
        ledger.connect(registrar).registerParcel(ethers.ZeroAddress, PLAN, docs("d"), "Plot 1", 100)
      ).to.be.revertedWithCustomError(ledger, "ZeroAddress");
    });

    it("stores no personal data, only a document hash", async () => {
      await register();
      const parcel = await ledger.getParcel(1);
      expect(parcel.documentHash).to.equal(docs("deed.pdf"));
      expect(Object.keys(parcel.toObject())).to.not.include.members(["name", "phone", "bvn"]);
    });
  });

  describe("transfers", () => {
    beforeEach(async () => register());

    it("moves land only after the owner proposes and a registrar approves", async () => {
      await expect(ledger.connect(ada).proposeTransfer(1, bola.address))
        .to.emit(ledger, "TransferProposed")
        .withArgs(1, ada.address, bola.address);
      expect((await ledger.getParcel(1)).owner).to.equal(ada.address); // not yet
      await expect(ledger.connect(registrar).approveTransfer(1))
        .to.emit(ledger, "TransferApproved")
        .withArgs(1, ada.address, bola.address, registrar.address);
      const parcel = await ledger.getParcel(1);
      expect(parcel.owner).to.equal(bola.address);
      expect(parcel.transfers).to.equal(1);
    });

    it("blocks a second sale while one is pending", async () => {
      await ledger.connect(ada).proposeTransfer(1, bola.address);
      await expect(ledger.connect(ada).proposeTransfer(1, stranger.address)).to.be.revertedWithCustomError(
        ledger,
        "TransferPending"
      );
    });

    it("the seller can't sell again after the land has moved", async () => {
      await ledger.connect(ada).proposeTransfer(1, bola.address);
      await ledger.connect(registrar).approveTransfer(1);
      await expect(ledger.connect(ada).proposeTransfer(1, stranger.address)).to.be.revertedWithCustomError(
        ledger,
        "NotOwner"
      );
    });

    it("only the owner can propose or cancel, and only a registrar can approve", async () => {
      await expect(ledger.connect(stranger).proposeTransfer(1, stranger.address)).to.be.revertedWithCustomError(
        ledger,
        "NotOwner"
      );
      await ledger.connect(ada).proposeTransfer(1, bola.address);
      await expect(ledger.connect(bola).approveTransfer(1)).to.be.revertedWithCustomError(ledger, "NotRegistrar");
      await expect(ledger.connect(stranger).cancelTransfer(1)).to.be.revertedWithCustomError(ledger, "NotOwner");
      await expect(ledger.connect(ada).cancelTransfer(1)).to.emit(ledger, "TransferCancelled");
      await expect(ledger.connect(registrar).approveTransfer(1)).to.be.revertedWithCustomError(
        ledger,
        "NoPendingTransfer"
      );
    });

    it("rejects self-transfers and the zero address", async () => {
      await expect(ledger.connect(ada).proposeTransfer(1, ada.address)).to.be.revertedWithCustomError(
        ledger,
        "SelfTransfer"
      );
      await expect(ledger.connect(ada).proposeTransfer(1, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        ledger,
        "ZeroAddress"
      );
    });
  });

  describe("disputes", () => {
    beforeEach(async () => register());

    it("a dispute freezes the parcel until it is cleared", async () => {
      await ledger.connect(ada).proposeTransfer(1, bola.address);
      await expect(ledger.connect(registrar).flagDispute(1, "Family claims part of the plot")).to.emit(
        ledger,
        "DisputeFlagged"
      );
      await expect(ledger.connect(registrar).approveTransfer(1)).to.be.revertedWithCustomError(ledger, "UnderDispute");
      await ledger.connect(ada).cancelTransfer(1);
      await expect(ledger.connect(ada).proposeTransfer(1, bola.address)).to.be.revertedWithCustomError(
        ledger,
        "UnderDispute"
      );

      await expect(ledger.connect(registrar).clearDispute(1, "Court ruled for owner")).to.emit(ledger, "DisputeCleared");
      await ledger.connect(ada).proposeTransfer(1, bola.address);
      await ledger.connect(registrar).approveTransfer(1);
      expect((await ledger.getParcel(1)).owner).to.equal(bola.address);
    });

    it("needs a reason, a registrar, and an open dispute to clear", async () => {
      await expect(ledger.connect(registrar).flagDispute(1, "")).to.be.revertedWithCustomError(ledger, "EmptyValue");
      await expect(ledger.connect(stranger).flagDispute(1, "x")).to.be.revertedWithCustomError(ledger, "NotRegistrar");
      await expect(ledger.connect(registrar).clearDispute(1, "x")).to.be.revertedWithCustomError(ledger, "NotDisputed");
    });
  });

  describe("verification", () => {
    it("tells a buyer who owns a parcel and whether it can be sold", async () => {
      await register();
      let [owner, disputed, pending, transfers] = await ledger.verify(1);
      expect([owner, disputed, pending, transfers]).to.deep.equal([ada.address, false, false, 0n]);
      await ledger.connect(ada).proposeTransfer(1, bola.address);
      await ledger.connect(registrar).flagDispute(1, "Check boundary");
      [owner, disputed, pending] = await ledger.verify(1);
      expect([owner, disputed, pending]).to.deep.equal([ada.address, true, true]);
    });

    it("reports unknown parcels instead of returning empty data", async () => {
      await expect(ledger.verify(99)).to.be.revertedWithCustomError(ledger, "UnknownParcel");
    });
  });
});
