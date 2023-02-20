import { readFileSync } from 'fs';
import path from 'path';
import { SimulateCosmWasmClient } from '../examples/simulate';
import { InstantiateMsg as OraiswapInstantiateMsg } from '../build/OraiswapToken.types';
import { Contract } from '../examples';

describe('sum module', () => {
  const senderAddress = 'orai1g4h64yjt0fvzv5v2j8tyfnpe5kmnetejvfgs7g';
  let airiContractAddress = '';
  const client = new SimulateCosmWasmClient({
    chainId: 'Oraichain',
    bech32Prefix: 'orai'
  });

  beforeAll(async () => {
    // init airi token
    const wasmBytecode = readFileSync(
      path.resolve(__dirname, 'oraiswap_token.wasm')
    );

    const { codeId } = client.upload(senderAddress, wasmBytecode);
    const initAiriRes = await client.instantiate(
      senderAddress,
      codeId,
      {
        decimals: 6,
        symbol: 'AIRI',
        name: 'Airight token',
        initial_balances: [{ address: senderAddress, amount: '1000000000' }]
      } as OraiswapInstantiateMsg,
      'token'
    );
    airiContractAddress = initAiriRes.contractAddress;
    await Contract.init(client);
  });

  test('balance airi token', async () => {
    const airiToken = Contract.token(airiContractAddress);
    const balanceRes = await airiToken.balance({ address: senderAddress });

    expect(balanceRes.balance).toBe('1000000000');
  });
});
