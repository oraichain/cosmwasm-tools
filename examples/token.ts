import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { Contract } from '.';

(async () => {
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    process.env.MNEMONIC,
    {
      prefix: process.env.PREFIX
    }
  );
  // init with signer
  await Contract.init(wallet);
  const tokenClient = Contract.token(process.env.AIRI_CONTRACT);
  console.log(Contract.sender);
  const balance = await tokenClient.balance({ address: Contract.sender });

  console.log(balance);
})();
