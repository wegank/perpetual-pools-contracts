import { ethers } from "hardhat";
import { ContractReceipt, Event } from "ethers";
import { Result } from "ethers/lib/utils";
import {
  LeveragedPool,
  TestPoolFactory__factory,
  TestToken,
  TestToken__factory,
} from "../typechain";

import { abi as Pool } from "../artifacts/contracts/implementation/LeveragedPool.sol/LeveragedPool.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

/**
 * Generates a random ethereum address
 * @returns A valid ethereum address, generated randomly
 */
export const generateRandomAddress = () => {
  return ethers.utils.getAddress(
    ethers.utils.hexlify(ethers.utils.randomBytes(20))
  );
};

/**
 * Generates a random integer between min and max, inclusive.
 * @param min The minimum value
 * @param max The maximum value
 * @returns Number The random integer
 */
export const getRandomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min) + min);

/**
 * Extracts the arguments from the first event to match eventType.
 * @param txReceipt the transaction receipt to process for events
 * @param eventType the event name to select
 * @returns Result the arguments
 */
export const getEventArgs = (
  txReceipt: ContractReceipt | undefined,
  eventType: string | undefined
): Result | undefined => {
  return txReceipt?.events?.find((el: Event) => el.event === eventType)?.args;
};

/**
 * Deploys a new instance of a pool, as well as an ERC20 token to use as a quote token.
 * @param POOL_CODE The pool identifier
 * @param firstPrice The initial value to set the lastPrice variable to in the contract
 * @param updateInterval The update interval value
 * @param frontRunningInterval The front running interval value. Must be less than the update interval
 * @param fee The fund movement fee.
 * @param leverage The amount of leverage the pool will apply
 * @param feeAddress The address to transfer fees to on a fund movement
 * @param amountMinted The amount of test quote tokens to mint
 * @returns {signers, token, pool} An object containing an array of ethers signers, a Contract instance for the token, and a Contract instance for the pool.
 */
export const deployPoolAndTokenContracts = async (
  POOL_CODE: string,
  firstPrice: number,
  updateInterval: number,
  frontRunningInterval: number,
  fee: number,
  leverage: number,
  feeAddress: string,
  amountMinted: number
): Promise<{
  signers: SignerWithAddress[];
  pool: LeveragedPool;
  token: TestToken;
}> => {
  const signers = await ethers.getSigners();
  // Deploy test ERC20 token
  const testToken = (await ethers.getContractFactory(
    "TestToken",
    signers[0]
  )) as TestToken__factory;
  const token = await testToken.deploy("TEST TOKEN", "TST1");
  await token.deployed();
  await token.mint(amountMinted, signers[0].address);

  // Deploy and initialise pool

  const testFactory = (await ethers.getContractFactory(
    "TestPoolFactory",
    signers[0]
  )) as TestPoolFactory__factory;
  const testFactoryActual = await testFactory.deploy();
  await testFactoryActual.deployed();
  const factoryReceipt = await (
    await testFactoryActual.createPool(POOL_CODE)
  ).wait();

  const pool = new ethers.Contract(
    getEventArgs(factoryReceipt, "CreatePool")?.pool,
    Pool,
    signers[0]
  ) as LeveragedPool;

  await pool.initialize(
    POOL_CODE,
    firstPrice,
    updateInterval,
    frontRunningInterval,
    fee,
    leverage,
    feeAddress,
    token.address
  );
  return { signers, pool, token };
};
