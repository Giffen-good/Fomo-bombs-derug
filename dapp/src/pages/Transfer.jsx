import { Connection, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getParsedNftAccountsByOwner,isValidSolanaAddress, createConnectionConfig,} from "@nfteyez/sol-rayz";
import axios from "axios";
// @TODO sub real FOMO hashlist for sample Hashlist before deployment
import HASHLIST from "../idl/devnet_sample_hash_list.json"
import {useConnection, useWallet} from "@solana/wallet-adapter-react";
import {useEffect, useState} from "react";
import {Card, Row, Col, Button, notification, Result} from 'antd';
import * as anchor from "@project-serum/anchor";
import {Program} from "@project-serum/anchor";

import SolMintNftIdl from "../idl/sol_mint_nft.json";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { Metadata } from "@metaplex-foundation/mpl-token-metadata";

import * as ipfsClient from "ipfs-http-client";

const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const SOL_MINT_NFT_PROGRAM_ID = new anchor.web3.PublicKey(
  "pL8iWWC6fuoMAnfhCcVVjPQ6XHL2ZzgcD9YyXs78qBc"
);
const ipfs = ipfsClient.create({
  host: "ipfs.infura.io",
  port: 5001,
  protocol: "https",
});

function List() {
  const createConnection = () => {
    return new Connection(clusterApiUrl("devnet"));
  };
  const [memberNFTs, setMemberNFTs ] = useState([])
  const [minting, setMinting] = useState(false);
  const [mintSuccess, setMintSuccess] = useState(false);
  const [uploading, setUploading] = useState(false);

  //check solana on window. This is useful to fetch address of your wallet.

  const getProvider = () => {
    if ("solana" in window) {
      const provider = window.solana;
      if (provider.isPhantom) {
        return provider;
      }
    }
  };
  const { connection } = useConnection();
  const wallet = useWallet();
  const getNftMetadata = async () => {
    const nftData = []
    const connection = createConnection()
    for (let i = 0; i < HASHLIST.length;i++) {
      const tokenMint = HASHLIST[i];
      const key = new anchor.web3.PublicKey(
        tokenMint
      )
      const metadataPDA = await Metadata.getPDA(key);
      const tokenMetadata = await Metadata.load(connection, metadataPDA);
      console.log(tokenMetadata);
      nftData.push(tokenMetadata)
    }
    return nftData
  }
  const getAllNftData = async () => {
    try {
      if (wallet.connected === true) {
        const connect =    createConnectionConfig(clusterApiUrl("devnet"));
        const provider = getProvider();
        let ownerToken = provider.publicKey;
        const result = isValidSolanaAddress(ownerToken);
        console.log("result", result);
        const nfts = await getParsedNftAccountsByOwner({
          publicAddress: ownerToken,
          connection: connect,
          serialization: true,
        });
        return nfts;
      }
    } catch (error) {
      console.log(error);
    }
  };
  //get NFT
  //Function to get all nft data
  const getNftTokenData = async () => {
    try {
      let nftData = await getAllNftData();
      console.log(nftData)
      var data = Object.keys(nftData).map((key) => nftData[key]);
      let arr = [];
      let n = data.length;
      for (let i = 0; i < n; i++) {
        const isFomoNFT = isMemberOfCollection(data[i])

        if (isFomoNFT) {
          let rawData = data[i];
          let metadata = await axios.get(data[i].data.uri);
          arr.push({rawData, metadata });
        }
      }
      return arr;
    } catch (error) {
      console.log(error);
    }
  };
  const isMemberOfCollection = (nft) => {
    for (let i = 0; i < HASHLIST.length; i++) {
      if (nft.mint == HASHLIST[i]) return true
    }
    return false
  }

  const onCreate = async () => {
    console.log("Connection: ", connection);
    console.log("Wallet: ", wallet);
    console.log(memberNFTs)
    const nftData = []
    for (let i = 0; i < memberNFTs.length;i++) {

      const tokenMetadata = memberNFTs[i].metadata.data;
      const name = `${tokenMetadata.name} V0.0`
      const description = tokenMetadata.description
      const uploadedImageUrl = tokenMetadata.image
      const nftSymbol = tokenMetadata.symbol
      const attributes = tokenMetadata.attributes

      let uploadedMetatdataUrl = await uploadMetadataToIpfs(
        name,
        nftSymbol,
        description,
        uploadedImageUrl,
        attributes
      );
      if (uploadedMetatdataUrl == null) return;
      console.log("Uploaded meta data url: ", uploadedMetatdataUrl);
      nftData.push(
        {name, symbol:nftSymbol, metadataUrl: uploadedMetatdataUrl}
      )
    }
    setMinting(true);
    const result = await transfer(nftData);
    setMinting(false);
    setMintSuccess(result);
  }
  const uploadMetadataToIpfs = async (
    name,
    symbol,
    description,
    uploadedImage,
    attributes
  ) => {
    const metadata = {
      name,
      symbol,
      description,
      image: uploadedImage,
      attributes: attributes
    };

    setUploading(true);
    const uploadedMetadata = await ipfs.add(JSON.stringify(metadata));
    setUploading(false);

    if (uploadedMetadata == null) {
      return null;
    } else {
      return `https://ipfs.infura.io/ipfs/${uploadedMetadata.path}`;
    }
  };

  const transfer = async (nftData) => {
    const provider = new anchor.AnchorProvider(connection, wallet);
    anchor.setProvider(provider);

    const program = new Program(
      SolMintNftIdl,
      SOL_MINT_NFT_PROGRAM_ID,
      provider
    );
    console.log("Program Id: ", program.programId.toBase58());
    console.log("Mint Size: ", MINT_SIZE);
    const lamports =
      await program.provider.connection.getMinimumBalanceForRentExemption(
        MINT_SIZE
      );
    console.log("Mint Account Lamports: ", lamports);

    const getMetadata = async (mint) => {
      return (
        await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            mint.toBuffer(),
          ],
          TOKEN_METADATA_PROGRAM_ID
        )
      )[0];
    };

    const mintKey = anchor.web3.Keypair.generate();

    const nftTokenAccount = await getAssociatedTokenAddress(
      mintKey.publicKey,
      provider.wallet.publicKey
    );
    console.log("NFT Account: ", nftTokenAccount.toBase58());

    const mint_tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mintKey.publicKey,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
        lamports,
      }),
      createInitializeMintInstruction(
        mintKey.publicKey,
        0,
        provider.wallet.publicKey,
        provider.wallet.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        provider.wallet.publicKey,
        nftTokenAccount,
        provider.wallet.publicKey,
        mintKey.publicKey
      )
    );
    let blockhashObj = await connection.getLatestBlockhash();
    console.log("blockhashObj", blockhashObj);
    mint_tx.recentBlockhash = blockhashObj.blockhash;

    try {
      const signature = await wallet.sendTransaction(mint_tx, connection, {
        signers: [mintKey],
      });
      await connection.confirmTransaction(signature, "confirmed");
    } catch {
      return false;
    }

    console.log("Mint key: ", mintKey.publicKey.toString());
    console.log("User: ", provider.wallet.publicKey.toString());

    const metadataAddress = await getMetadata(mintKey.publicKey);
    console.log("Metadata address: ", metadataAddress.toBase58());

    try {
      for (let i = 0; i < nftData.length; i++) {
        const { name, symbol, metadataUrl} = nftData[i]
        const tx = program.transaction.mintNft(
          mintKey.publicKey,
          name,
          symbol,
          metadataUrl,
          {
            accounts: {
              mintAuthority: provider.wallet.publicKey,
              mint: mintKey.publicKey,
              tokenAccount: nftTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
              metadata: metadataAddress,
              tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
              payer: provider.wallet.publicKey,
              systemProgram: anchor.web3.SystemProgram.programId,
              rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            },
          }
        );

        const signature = await wallet.sendTransaction(tx, connection);
        await connection.confirmTransaction(signature, "confirmed");
        console.log("Mint Success!");
      }
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      // get the data from the api
      const d = await getNftTokenData();
      setMemberNFTs(d)
      const nftFromHashlist = await getNftMetadata();
      console.log(nftFromHashlist)
    }
    fetchData().catch(console.error);
  },[])

  if (mintSuccess) {
    return (
      <Result
        style={{ marginTop: 60 }}
        status="success"
        title="Successfully minted! BOMB baby"
        subTitle="You can check this new NFT in your wallet."
      />
    );
  }
  return (
    <div className={'list-page'}>
      {memberNFTs.length ?
        <>
          <TableOfNFTs memberNFTs={memberNFTs} />
          <Button type={'primary'} className={'mint nfts'} onClick={onCreate}>Burn & Swap FOMO Bombs</Button>
        </>
        : <Button type={'primary'} className={'mint nfts'} disabled></Button>}

    </div>
  )
}
function TableOfNFTs({memberNFTs}) {
  if (!memberNFTs) return
  return (
    <Row style={{ margin: 30 }}>
      <Col span={16} offset={4} style={{ marginTop: 10 }}>
        <Card  id={'nft-table site-card-wrapper'}>
          <Row gutter={16} justify={"start"}>
            {memberNFTs.map((nft, k) => {
              return <NFTProductCard key={k} k={k} metadata={nft.metadata} />
            })}
          </Row>
        </Card>
      </Col>
    </Row>

  )
}
const NFTProductCard = ({metadata, k}) => {
  const { Meta } = Card;
  const d = metadata.data;
  const name = `${d.name} (${d.symbol})`
  if (!d) return
  console.log('tokenData:', d)
  return (
    <Col key={k.toString()} span={8}>
      <Card
        hoverable
        style={{
          width: 240,
        }}
        cover={<img alt="FOMO BOMB" src={d.image} />}
      >
        <Meta title={name} description={d.description} />
      </Card>
      {/*{nft.data.uri ? <*/}
    </Col>
  )
}
export default List;