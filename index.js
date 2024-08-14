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
    name: `地址 ${index}: ${address}`,
    value: addresses[index]
  }));

  const { selectedAddress } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedAddress',
      message: '请选择您想要使用的地址:',
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
      message: '请输入接收者地址:',
      validate: input => /^0x[a-fA-F0-9]{40}$/.test(input) || '请输入有效的以太坊地址'
    },
    {
      type: 'number',
      name: 'value',
      message: '请输入要发送的ETH数量:',
      validate: input => input > 0 || '请输入大于0的数值'
    }
  ]);

  return { to, value: parseEther(value.toString()) };
}

async function signWithLedger() {
  console.log('正在连接到Ledger设备...');
  const transport = await TransportNodeHid.create();
  const eth = new Eth(transport);
  
  try {
    console.log('正在获取地址列表...');
    const addresses = await getAddresses(transport, 0, 4);
    
    const selectedAddress = await selectAddress(addresses);
    console.log('选择的地址:', selectedAddress.address);

    const publicClient = createPublicClient({
      chain: mainnet,
      transport: http()
    });

    const { to, value } = await inputTransactionDetails();

    console.log('正在准备交易...');
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
    
    console.log('请在Ledger设备上确认交易...');
    const signature = await eth.signTransaction(selectedAddress.path, unsignedTx.slice(2));
    
    const signedTransaction = serializeTransaction(transaction, {
      r: `0x${signature.r}`,
      s: `0x${signature.s}`,
      v: BigInt(signature.v)
    });

    console.log('交易已签名');
    console.log('签名后的交易:', signedTransaction);

    const { confirmSend } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmSend',
        message: '是否发送这笔交易?',
        default: false
      }
    ]);

    if (confirmSend) {
      const txHash = await publicClient.sendRawTransaction({ serializedTransaction: signedTransaction });
      console.log('交易已发送，交易哈希:', txHash);
    } else {
      console.log('交易未发送');
    }
  } catch (error) {
    console.error('过程中出错:', error);
  } finally {
    await transport.close();
    console.log('与Ledger设备的连接已关闭');
  }
}

signWithLedger();
