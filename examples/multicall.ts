import { MulticallQueryClient } from '../build/Multicall.client';
import {
  BalanceResponse,
  QueryMsg as TokenQueryMsg
} from '../build/OraiswapToken.types';
import {
  CosmWasmClient,
  fromBinary,
  toBinary
} from '@cosmjs/cosmwasm-stargate';

(async () => {
  const client = await CosmWasmClient.connect('https://testnet.rpc.orai.io');
  const multicall = new MulticallQueryClient(
    client,
    'orai1yv8dnskhj427hd79xkk34zlvcyzkw7tve09ktp89jhr6x2r0rumsmnj07f'
  );
  const addresses = [
    'orai14n3tx8s5ftzhlxvq0w5962v60vd82h30rha573',
    'orai1qdsj06kp9l92nekfxe5jmen34fz8zh86qtygca'
  ];
  const res = await multicall.aggregate({
    queries: addresses.map((address) => ({
      address: 'orai1gwe4q8gme54wdk0gcrtsh4ykwvd7l9n3dxxas2',
      data: toBinary({
        balance: { address }
      } as TokenQueryMsg)
    }))
  });

  const result = Object.fromEntries(
    addresses.map((address, ind) => {
      const balanceRes = fromBinary(
        res.return_data[ind].data
      ) as BalanceResponse;
      return [address, balanceRes.balance];
    })
  );

  console.log(result);
})();
