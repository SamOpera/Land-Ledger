import { describe, expect, it } from "vitest"
import { id } from "ethers"

import { ContractError, ZERO, checkPlan, lookup, planHash, titleStatus } from "../src/lib/chain"
import { DemoChain, demoAccounts } from "../src/lib/demo"

const { bureau, registrar, ada, bola } = demoAccounts
const DOC = id("deed.pdf")

/** A fresh demo chain with instant transactions, acting as the given account. */
function setup() {
  const chain = new DemoChain()
  const act = chain.actions(0)
  const as = (who: keyof typeof demoAccounts) => {
    chain.setAccount(who)
    return act
  }
  return { chain, as }
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof ContractError ? e.code : String(e))
  )

describe("survey plan numbers", () => {
  it("hash the same however they are typed", () => {
    expect(planHash(" la/1234/2024 ")).toBe(planHash("LA/1234/2024"))
    expect(planHash("LA / 1234 / 2024")).toBe(planHash("LA/1234/2024"))
    expect(planHash("LA/1234/2025")).not.toBe(planHash("LA/1234/2024"))
  })
})

describe("demo chain follows the contract's rules", () => {
  it("starts with a believable history", () => {
    const { chain } = setup()
    const s = chain.getState()
    expect(s.bureau).toBe(bureau.address)
    expect(s.registrars).toEqual([registrar.address])
    expect(s.parcels.map(titleStatus)).toEqual(["clear", "disputed", "clear"])
    expect(s.parcels[2].owner).toBe(bola.address) // sold once
  })

  it("only the bureau appoints registrars and approves plans", async () => {
    const { as } = setup()
    expect(await code(as("ada").setRegistrar(ada.address, true))).toBe("NotBureau")
    expect(await code(as("registrar").approveSurveyPlan("LA/9/2026"))).toBe("NotBureau")
    expect(await code(as("bureau").approveSurveyPlan("la/1234/2024"))).toBe("PlanAlreadyKnown")
  })

  it("registers each survey plan once, and only approved plans", async () => {
    const { as, chain } = setup()
    expect(await code(as("registrar").registerParcel(ada.address, "LA/3310/2025", DOC, "Plot 4, Epe", 500))).toBe("ok")
    expect(await code(as("registrar").registerParcel(bola.address, "LA/3310/2025", DOC, "Plot 4, Epe", 500))).toBe(
      "PlanUsed"
    )
    expect(await code(as("registrar").registerParcel(ada.address, "FAKE/1", DOC, "Nowhere", 1))).toBe("PlanNotApproved")
    expect(await code(as("ada").registerParcel(ada.address, "LA/3310/2025", DOC, "x", 1))).toBe("NotRegistrar")
    expect(chain.getState().parcels).toHaveLength(4)
  })

  it("moves land only with the owner's offer and a registrar's approval", async () => {
    const { as, chain } = setup()
    expect(await code(as("bola").proposeTransfer(1, bola.address))).toBe("NotOwner")
    expect(await code(as("ada").proposeTransfer(1, ada.address))).toBe("SelfTransfer")
    expect(await code(as("ada").proposeTransfer(1, bola.address))).toBe("ok")
    expect(chain.getState().parcels[0].owner).toBe(ada.address) // not yet
    expect(await code(as("ada").proposeTransfer(1, registrar.address))).toBe("TransferPending")
    expect(await code(as("bola").approveTransfer(1))).toBe("NotRegistrar")
    expect(await code(as("registrar").approveTransfer(1))).toBe("ok")
    const p = chain.getState().parcels[0]
    expect([p.owner, p.pendingBuyer, p.transfers]).toEqual([bola.address, ZERO, 1])
    expect(await code(as("ada").proposeTransfer(1, registrar.address))).toBe("NotOwner")
  })

  it("freezes a disputed parcel until a registrar clears it", async () => {
    const { as } = setup()
    expect(await code(as("bola").proposeTransfer(2, ada.address))).toBe("UnderDispute")
    expect(await code(as("bola").clearDispute(2, "x"))).toBe("NotRegistrar")
    expect(await code(as("registrar").clearDispute(2, "Court ruled for owner"))).toBe("ok")
    expect(await code(as("registrar").clearDispute(2, "again"))).toBe("NotDisputed")
    expect(await code(as("bola").proposeTransfer(2, ada.address))).toBe("ok")
  })

  it("rejects empty details", async () => {
    const { as } = setup()
    expect(await code(as("registrar").flagDispute(1, "  "))).toBe("EmptyValue")
    expect(await code(as("registrar").registerParcel(ada.address, "LA/3310/2025", DOC, "", 500))).toBe("EmptyValue")
    expect(await code(as("registrar").registerParcel("not-an-address", "LA/3310/2025", DOC, "x", 5))).toBe("ZeroAddress")
  })

  it("records every change as an event tied to its parcel", async () => {
    const { as, chain } = setup()
    await as("ada").proposeTransfer(1, bola.address)
    await as("ada").cancelTransfer(1)
    const names = chain.getState().events.filter((e) => e.parcelId === 1).map((e) => e.name)
    expect(names.slice(0, 3)).toEqual(["TransferCancelled", "TransferProposed", "ParcelRegistered"])
  })
})

describe("verify lookup", () => {
  it("finds a parcel by number or by survey plan, and nothing for unknowns", () => {
    const { chain } = setup()
    const parcels = chain.getState().parcels
    expect(lookup(parcels, "1")?.id).toBe(1)
    expect(lookup(parcels, "#3")?.id).toBe(3)
    expect(lookup(parcels, "oy/0877/2023")?.id).toBe(2)
    expect(lookup(parcels, "99")).toBeNull()
    expect(lookup(parcels, "LA/0000/2020")).toBeNull()
    expect(lookup(parcels, "  ")).toBeNull()
  })
})

describe("plan check before sending", () => {
  it("tells the bureau and registrar what the ledger knows about a plan", () => {
    const { chain } = setup()
    const plans = chain.getState().plans
    expect(checkPlan(plans, "")).toBe("empty")
    expect(checkPlan(plans, "0x0800f305140235E0FD8e7adB83c15d3f6dD4C0e8")).toBe("address")
    expect(checkPlan(plans, "la/3310/2025")).toBe("approved")
    expect(checkPlan(plans, "LA/1234/2024")).toBe("used")
    expect(checkPlan(plans, "LA/7777/2026")).toBe("unknown")
  })
})
