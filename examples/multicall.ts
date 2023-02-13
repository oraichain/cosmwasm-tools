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

  const res = await multicall.aggregate({
    queries: [
      {
        address: 'orai1gwe4q8gme54wdk0gcrtsh4ykwvd7l9n3dxxas2',
        data: toBinary({
          balance: { address: 'orai14n3tx8s5ftzhlxvq0w5962v60vd82h30rha573' }
        } as TokenQueryMsg)
      },
      {
        address: 'orai1gwe4q8gme54wdk0gcrtsh4ykwvd7l9n3dxxas2',
        data: toBinary({
          balance: { address: 'orai1qdsj06kp9l92nekfxe5jmen34fz8zh86qtygca' }
        } as TokenQueryMsg)
      }
    ]
  });

  for (const data of res.return_data) {
    if (data.success) {
      const result = fromBinary(data.data) as BalanceResponse;
      console.log(result.balance);
    }
  }
})();
