import 'dotenv/config';
import { Contract } from '.';

Contract.init(process.env.MNEMONIC).then(async () => {
  const tokenClient = Contract.token(process.env.AIRI_CONTRACT);
  console.log(Contract.sender);
  const accounts = await tokenClient.allAccounts({ limit: 100 });

  console.log(accounts);
});
