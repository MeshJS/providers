import { BlockfrostProvider } from "@meshsdk/provider";

// the axios instance is stubbed, no server and no project id needed
const axiosError = (status: number) =>
  Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    response: {
      status,
      data: { status_code: status },
      headers: {},
    },
  });

// answers by path; a path with no answer fails with 404
const makeProvider = (answers: Record<string, unknown>) => {
  const provider = new BlockfrostProvider("https://blockfrost.test/api/v0");
  const get = jest.fn(async (url: string) => {
    const answer = answers[url];
    if (answer === undefined) throw axiosError(404);
    if (answer instanceof Error) throw answer;
    return { status: 200, data: answer };
  });
  (provider as any)._axiosInstance = { get };
  return { provider, get };
};

const BLOCK_HASH = "ab".repeat(32);
const PREVIOUS_HASH = "cd".repeat(32);
const NEXT_HASH = "ef".repeat(32);
const TX_HASH = "12".repeat(32);

const blockAnswer = (extra: Record<string, unknown> = {}) => ({
  time: 1700000000,
  height: 4123456,
  hash: BLOCK_HASH,
  slot: 98765432,
  epoch: 230,
  epoch_slot: 12345,
  slot_leader: "pool1xyz",
  size: 2048,
  tx_count: 3,
  output: "125000000",
  fees: "550000",
  block_vrf: "vrf_vk1xyz",
  op_cert: "34".repeat(32),
  op_cert_counter: "7",
  previous_block: PREVIOUS_HASH,
  next_block: NEXT_HASH,
  confirmations: 5,
  ...extra,
});

// the block result without `height`
const blockResult = {
  confirmations: 5,
  epoch: 230,
  epochSlot: "12345",
  fees: "550000",
  hash: BLOCK_HASH,
  nextBlock: NEXT_HASH,
  operationalCertificate: "34".repeat(32),
  output: "125000000",
  previousBlock: PREVIOUS_HASH,
  size: 2048,
  slot: "98765432",
  slotLeader: "pool1xyz",
  time: 1700000000,
  txCount: 3,
  VRFKey: "vrf_vk1xyz",
};

const txAnswer = (extra: Record<string, unknown> = {}) => ({
  hash: TX_HASH,
  block: BLOCK_HASH,
  block_height: 4123456,
  block_time: 1700000000,
  slot: 98765432,
  index: 1,
  output_amount: [{ unit: "lovelace", quantity: "5000000" }],
  fees: "180000",
  deposit: "0",
  size: 300,
  invalid_before: null,
  invalid_hereafter: "98800000",
  utxo_count: 3,
  withdrawal_count: 0,
  mir_cert_count: 0,
  delegation_count: 0,
  stake_cert_count: 0,
  pool_update_count: 0,
  pool_retire_count: 0,
  asset_mint_or_burn_count: 0,
  redeemer_count: 0,
  valid_contract: true,
  ...extra,
});

const utxosAnswer = (extra: Record<string, unknown> = {}) => ({
  hash: TX_HASH,
  inputs: [
    {
      address: "addr_test1in",
      amount: [{ unit: "lovelace", quantity: "5180000" }],
      tx_hash: "56".repeat(32),
      output_index: 0,
    },
  ],
  outputs: [
    {
      address: "addr_test1out",
      amount: [{ unit: "lovelace", quantity: "5000000" }],
      output_index: 0,
    },
  ],
  ...extra,
});

// the transaction result without `blockHeight` and `validContract`
const txResult = {
  block: BLOCK_HASH,
  deposit: "0",
  fees: "180000",
  hash: TX_HASH,
  index: 1,
  invalidAfter: "98800000",
  invalidBefore: "",
  slot: "98765432",
  size: 300,
  inputs: utxosAnswer().inputs,
  outputs: utxosAnswer().outputs,
};

const txAnswers = (
  tx: Record<string, unknown> = {},
  utxos: Record<string, unknown> = {},
) => ({
  [`txs/${TX_HASH}`]: txAnswer(tx),
  [`/txs/${TX_HASH}/utxos`]: utxosAnswer(utxos),
});

describe("BlockfrostProvider block heights and validContract", () => {
  it("fetchLatestBlock gives the height of the block", async () => {
    const { provider, get } = makeProvider({ "blocks/latest": blockAnswer() });

    const block = await provider.fetchLatestBlock();

    expect(block).toEqual({ ...blockResult, height: 4123456 });
    expect(get.mock.calls).toEqual([["blocks/latest"]]);
  });

  it("fetchBlockInfo gives the height of the block", async () => {
    const { provider, get } = makeProvider({
      [`blocks/${BLOCK_HASH}`]: blockAnswer(),
    });

    const block = await provider.fetchBlockInfo(BLOCK_HASH);

    expect(block).toEqual({ ...blockResult, height: 4123456 });
    expect(get.mock.calls).toEqual([[`blocks/${BLOCK_HASH}`]]);
  });

  it("fetchTxInfo gives blockHeight and validContract of the transaction", async () => {
    const { provider, get } = makeProvider(txAnswers());

    const tx = await provider.fetchTxInfo(TX_HASH);

    expect(tx).toEqual({
      ...txResult,
      blockHeight: 4123456,
      validContract: true,
    });
    expect(get.mock.calls).toEqual([
      [`txs/${TX_HASH}`],
      [`/txs/${TX_HASH}/utxos`],
    ]);
  });

  it("fetchTxInfo gives validContract false when a script failed", async () => {
    const { provider } = makeProvider(txAnswers({ valid_contract: false }));

    const tx = await provider.fetchTxInfo(TX_HASH);

    expect(tx).toMatchObject({ blockHeight: 4123456, validContract: false });
  });

  it("fetchTxInfo takes both fields from the transaction, not from its utxos", async () => {
    const { provider } = makeProvider(
      txAnswers({}, { block_height: 99, valid_contract: false }),
    );

    const tx = await provider.fetchTxInfo(TX_HASH);

    expect(tx).toEqual({
      ...txResult,
      blockHeight: 4123456,
      validContract: true,
    });
  });

  it("keeps a height of zero", async () => {
    const { provider } = makeProvider({
      "blocks/latest": blockAnswer({ height: 0 }),
      [`blocks/${BLOCK_HASH}`]: blockAnswer({ height: 0 }),
      ...txAnswers({ block_height: 0 }),
    });

    expect(await provider.fetchLatestBlock()).toMatchObject({ height: 0 });
    expect(await provider.fetchBlockInfo(BLOCK_HASH)).toMatchObject({
      height: 0,
    });
    expect(await provider.fetchTxInfo(TX_HASH)).toMatchObject({
      blockHeight: 0,
    });
  });

  it("gives undefined, not null, for a missing or null member", async () => {
    const noMembers = txAnswer();
    delete (noMembers as Record<string, unknown>).block_height;
    delete (noMembers as Record<string, unknown>).valid_contract;

    const nullBlock = makeProvider({
      "blocks/latest": blockAnswer({ height: null }),
      [`blocks/${BLOCK_HASH}`]: blockAnswer({ height: null }),
    }).provider;
    const missingTx = makeProvider({
      [`txs/${TX_HASH}`]: noMembers,
      [`/txs/${TX_HASH}/utxos`]: utxosAnswer(),
    }).provider;
    const nullTx = makeProvider(
      txAnswers({ block_height: null, valid_contract: null }),
    ).provider;

    expect(await nullBlock.fetchLatestBlock()).toEqual(blockResult);
    expect(await nullBlock.fetchBlockInfo(BLOCK_HASH)).toEqual(blockResult);
    expect(await missingTx.fetchTxInfo(TX_HASH)).toEqual(txResult);
    expect(await nullTx.fetchTxInfo(TX_HASH)).toEqual(txResult);
  });

  it("fetchTxInfo of an unknown hash rejects with status 404 after one request", async () => {
    const { provider, get } = makeProvider({});

    const error = await provider.fetchTxInfo(TX_HASH).catch((e) => e);

    expect(typeof error).toBe("string");
    expect(JSON.parse(error).status).toBe(404);
    expect(get.mock.calls).toEqual([[`txs/${TX_HASH}`]]);
  });

  it("fetchAddressTxs carries validContract and the heights of the address list", async () => {
    const { provider } = makeProvider({
      "/addresses/addr_test1xyz/transactions?page=1&order=desc": [
        {
          tx_hash: TX_HASH,
          tx_index: 1,
          block_height: 4123400,
          block_time: 1699999000,
        },
      ],
      "/addresses/addr_test1xyz/transactions?page=2&order=desc": [],
      ...txAnswers({ valid_contract: false }),
    });

    const txs = await provider.fetchAddressTxs("addr_test1xyz");

    expect(txs).toEqual([
      {
        ...txResult,
        blockHeight: 4123400,
        blockTime: 1699999000,
        validContract: false,
      },
    ]);
  });

  it("fetchTxInfo rejects when the utxos request fails", async () => {
    const { provider, get } = makeProvider({
      [`txs/${TX_HASH}`]: txAnswer(),
      [`/txs/${TX_HASH}/utxos`]: axiosError(500),
    });

    const error = await provider.fetchTxInfo(TX_HASH).catch((e) => e);

    expect(typeof error).toBe("string");
    expect(JSON.parse(error).status).toBe(500);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
