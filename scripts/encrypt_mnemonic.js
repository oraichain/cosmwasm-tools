const readlineSync = require('readline-sync');
const { encrypt } = require('../src/common');

module.exports = async (argv) => {
  const mnemonic = readlineSync.question('enter mnemonic:', { hideEchoBack: true });
  const password = readlineSync.question('enter passphrase:', { hideEchoBack: true });

  console.log(encrypt(password, mnemonic));
};
