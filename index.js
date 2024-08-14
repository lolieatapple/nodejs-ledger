const TransportNodeHid = require('@ledgerhq/hw-transport-node-hid').default;
const Eth = require('@ledgerhq/hw-app-eth').default;
const { createPublicClient, http, parseEther, serializeTransaction } = require('viem');
const { mainnet } = require('viem/chains');
const inquirer = require('inquirer').default;

async function getAddresses(transport, startIndex, endIndex) {
  const eth = new Eth(transport);
  const addresses = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const path = `m/44'/60'/${i}'/0/0`;
    const result = await eth.getAddress(path);
    addresses.push({ index: i, address: result.address, path });
  }
  return addresses;
}

async function selectAddress(addresses) {
  const choices = addresses.map(({ index, address }) => ({
    name: `Address ${index}: ${address}`,
    value: addresses[index]
  }));

  const { selectedAddress } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedAddress',
      message: 'Please select the address you want to use:',
      choices: choices
    }
  ]);

  return selectedAddress;
}

async function inputTransactionDetails() {
  const { to, value } = await inquirer.prompt([
    {
      type: 'input',
      name: 'to',
      message: 'Please enter the recipient address:',
      validate: input => /^0x[a-fA-F0-9]{40}$/.test(input) || 'Please enter a valid Ethereum address'
    },
    {
      type: 'number',
      name: 'value',
      message: 'Please enter the amount of ETH to send:',
      validate: input => input > 0 || 'Please enter a value greater than 0'
    }
  ]);

  return { to, value: parseEther(value.toString()) };
}

async function signWithLedger() {
  console.log('Connecting to Ledger device...');
  const transport = await TransportNodeHid.create();
  const eth = new Eth(transport);
  
  try {
    console.log('Getting address list...');
    const addresses = await getAddresses(transport, 0, 4);
    
    const selectedAddress = await selectAddress(addresses);
    console.log('Selected address:', selectedAddress.address);

    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http()
    });

    const { to, value } = await inputTransactionDetails();

    console.log('Preparing transaction...');
    const nonce = await publicClient.getTransactionCount({ address: selectedAddress.address });
    const gasPrice = await publicClient.getGasPrice();
    const chainId = await publicClient.getChainId();

    const transaction = {
      to,
      value,
      gasPrice,
      gasLimit: 21000n,
      nonce,
      chainId
    };

    const unsignedTx = serializeTransaction(transaction);
    
    console.log('Please confirm the transaction on your Ledger device...');
    const signature = await eth.signTransaction(selectedAddress.path, unsignedTx.slice(2));
    
    const signedTransaction = serializeTransaction(transaction, {
      r: `0x${signature.r}`,
      s: `0x${signature.s}`,
      v: BigInt(signature.v)
    });

    console.log('Transaction signed');
    console.log('Signed transaction:', signedTransaction);

    const { confirmSend } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmSend',
        message: 'Do you want to send this transaction?',
        default: false
      }
    ]);

    if (confirmSend) {
      const txHash = await publicClient.sendRawTransaction({ serializedTransaction: signedTransaction });
      console.log('Transaction sent, transaction hash:', txHash);
    } else {
      console.log('Transaction not sent');
    }
  } catch (error) {
    console.error('An error occurred during the process:', error);
  } finally {
    await transport.close();
    console.log('Connection to Ledger device closed');
  }
}

signWithLedger();