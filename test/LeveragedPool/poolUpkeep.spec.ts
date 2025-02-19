import { ethers } from "hardhat"
import chai from "chai"
import chaiAsPromised from "chai-as-promised"
import {
    LeveragedPool,
    TestToken,
    ERC20,
    PoolSwapLibrary,
    PoolCommitter,
    L2Encoder,
} from "../../types"

import {
    POOL_CODE,
    DEFAULT_FEE,
    LONG_MINT,
    LONG_BURN,
    SHORT_MINT,
} from "../constants"
import {
    deployPoolAndTokenContracts,
    getRandomInt,
    generateRandomAddress,
    createCommit,
    CommitEventArgs,
    timeout,
} from "../utilities"
import { Bytes, BigNumber } from "ethers"
chai.use(chaiAsPromised)
const { expect } = chai

const amountCommitted = ethers.utils.parseEther("2000")
const amountMinted = ethers.utils.parseEther("10000")
const feeAddress = generateRandomAddress()
const lastPrice = ethers.utils.parseEther(getRandomInt(99999999, 1).toString())
const updateInterval = 200
const frontRunningInterval = 100 // seconds
const fee = DEFAULT_FEE
const leverage = 1

describe("LeveragedPool - executeAllCommitments", async () => {
    let poolCommitter: PoolCommitter
    let token: TestToken
    let shortToken: ERC20
    let longToken: ERC20
    let pool: LeveragedPool
    let library: PoolSwapLibrary
    let l2Encoder: L2Encoder

    const commits: CommitEventArgs[] | undefined = []
    beforeEach(async () => {
        const result = await deployPoolAndTokenContracts(
            POOL_CODE,
            frontRunningInterval,
            updateInterval,
            leverage,
            feeAddress,
            fee
        )
        l2Encoder = result.l2Encoder
        pool = result.pool
        library = result.library
        poolCommitter = result.poolCommitter
        const signers = await ethers.getSigners()
        await pool.setKeeper(signers[0].address)
        token = result.token
        shortToken = result.shortToken
        longToken = result.longToken

        await token.approve(pool.address, amountMinted)

        // Long mint commit
        await createCommit(l2Encoder, poolCommitter, LONG_MINT, amountCommitted)
        // short mint commit
        await createCommit(
            l2Encoder,
            poolCommitter,
            SHORT_MINT,
            amountCommitted
        )

        await timeout(updateInterval * 1000)

        // No price change so only commits are executed
        await pool.poolUpkeep(lastPrice, lastPrice)

        // await poolCommitter.updateAggregateBalance(signers[0].address)
        await poolCommitter.claim(signers[0].address)
        // End state: `amountCommitted` worth of Long and short token minted. Price = lastPrice
    })

    describe("With one Long Mint and one Long Burn and normal price change", async () => {
        it("Updates state", async () => {
            // Long mint commit
            await createCommit(
                l2Encoder,
                poolCommitter,
                LONG_MINT,
                amountCommitted
            )
            // Long burn commit
            await createCommit(
                l2Encoder,
                poolCommitter,
                LONG_BURN,
                amountCommitted.div(2)
            )
            await timeout(updateInterval * 1000)

            const shortTokenTotalSupplyBefore = await shortToken.totalSupply()
            const longTokenTotalSupplyBefore = await longToken.totalSupply()
            const longBalanceBefore = await pool.longBalance()
            const shortBalanceBefore = await pool.shortBalance()
            // Double the price
            await pool.poolUpkeep(lastPrice, BigNumber.from("2").mul(lastPrice))

            const shortTokenTotalSupplyAfter = await shortToken.totalSupply()
            const longTokenTotalSupplyAfter = await longToken.totalSupply()

            // tokensMinted = 1 / ((settlement/poolToken) / settlementCommitted)
            //              = 1 / ((3000 / 2000) / amountCommitted)
            //              = 1333.3333333...
            const expectedLongTokenDifference = ethers.utils.parseEther(
                "1333.333333333333333333"
            )

            // Should be equal since the commits are long commits
            expect(shortTokenTotalSupplyAfter).to.equal(
                shortTokenTotalSupplyBefore
            )
            expect(
                longTokenTotalSupplyAfter.sub(longTokenTotalSupplyBefore)
            ).to.equal(expectedLongTokenDifference)

            const longBalanceAfter = await pool.longBalance()
            const shortBalanceAfter = await pool.shortBalance()

            const shortBalanceDecrease = shortBalanceBefore
                .sub(shortBalanceAfter)
                .toString()

            // Based on token price, (3000 / 2000)
            // price * poolTokensBurnt
            // = (3000 / 2000) * 1000 = 1500
            const longBalanceDecreaseOnBurn = ethers.utils.parseEther(
                "1500"
            )
            expect(longBalanceDecreaseOnBurn).to.equal(
                longBalanceBefore
                    .add(shortBalanceDecrease)
                    .add(amountCommitted)
                    .sub(longBalanceAfter)
            )
            // Long balance should increase by (the amount shortBalance decreases) + (the amount LONG MINT committed) - (the burn amount from the LONG BURN)
            expect(longBalanceAfter).to.equal(
                longBalanceBefore
                    .add(shortBalanceDecrease)
                    .add(amountCommitted)
                    .sub(longBalanceDecreaseOnBurn)
            )
        })
    })

    /*
    describe("Short mint->short burn", () => {
        const commits: CommitEventArgs[] | undefined = []
        beforeEach(async () => {
            const result = await deployPoolAndTokenContracts(
                POOL_CODE,
                frontRunningInterval,
                updateInterval,
                leverage,
                feeAddress,
                fee
            )
            pool = result.pool
            library = result.library

            token = result.token
            shortToken = result.shortToken
            await pool.setKeeper(result.signers[0].address)

            await token.approve(pool.address, amountMinted)

            const commit = await createCommit(l2Encoder, pool, [0], amountCommitted)

            await shortToken.approve(pool.address, amountMinted)
            await timeout(2000)

            await pool.executePriceChange(lastPrice, 10)
            await pool.executeCommitment([commit.commitID])

            commits.push(await createCommit(l2Encoder, pool, [0], amountCommitted))
            commits.push(await createCommit(l2Encoder, pool, [1], amountCommitted.div(2)))
        })
        it("should reduce the balances of the shadows pools involved", async () => {
            // Short mint and burn pools
            expect(await pool.shadowPools(commits[0].commitType)).to.eq(
                amountCommitted
            )
            expect(await pool.shadowPools(commits[1].commitType)).to.eq(
                amountCommitted.div(2)
            )
            await timeout(2000)
            await pool.executePriceChange(lastPrice, 10)
            await pool.executeCommitment([
                commits[0].commitID,
                commits[1].commitID,
            ])

            expect(await pool.shadowPools(commits[0].commitType)).to.eq(0)
            expect(await pool.shadowPools(commits[1].commitType)).to.eq(0)
        })
        it("should adjust the balances of the live pools involved", async () => {
            expect(await pool.shortBalance()).to.eq(amountCommitted)
            await timeout(2000)
            await pool.executePriceChange(lastPrice, 10)

            await pool.executeCommitment([
                commits[0].commitID,
                commits[1].commitID,
            ])

            expect(await pool.shortBalance()).to.eq(
                amountCommitted.add(amountCommitted.div(2))
            )
        })
    })
    */
})
