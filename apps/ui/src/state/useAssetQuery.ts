import { Asset, EthereumERC20, EthereumEther, NervosSUDT } from '@force-bridge/commons';
import { QueryObserverResult, useQuery } from 'react-query';
import { boom } from 'interfaces/errors';
import { useForceBridge } from 'state/global';
import { asserts } from 'utils';

type Assets = { xchain: Asset[]; nervos: NervosSUDT[] };

export function useAssetQuery(): QueryObserverResult<Assets> {
  const { api, direction, network, signer, xchainModule } = useForceBridge();

  const X = xchainModule.assetModel;

  const { data: infos } = useQuery(['getAssetAssetWithInfo', { network }], async () => {
    const infoList = await api.getAssetList();

    // xchain asset info: asset.info
    const xchainAssetsInfo = infoList.filter(X.isCurrentNetworkAsset).map<Asset>((assetWithInfo) => {
      // TODO refactor to ModuleRegistry
      if (assetWithInfo.network === 'Ethereum') {
        const ident = assetWithInfo.ident;
        const info = assetWithInfo.info;

        const sudt = new NervosSUDT({
          info: {
            ...assetWithInfo.info,
            shadow: assetWithInfo,
            name: `ck${assetWithInfo.info.name}`,
            symbol: `ck${assetWithInfo.info.symbol}`,
          },
          ...info.shadow,
        });

        let xchainAsset: Asset;
        if (X.isDerivedAsset(assetWithInfo)) {
          xchainAsset = new EthereumERC20({ ident, info, shadow: sudt });
        } else if (X.isNativeAsset(assetWithInfo)) {
          xchainAsset = new EthereumEther({ info, shadow: sudt });
        } else {
          boom(`asset is not valid ${JSON.stringify(assetWithInfo)}`);
        }

        sudt.setShadow(xchainAsset);

        return xchainAsset;
      }

      return boom('');
    });

    // xchain asset.shadow
    const nervosAssetsInfo = xchainAssetsInfo.map<NervosSUDT>((xchainAsset) => {
      asserts(xchainAsset.shadow != null);
      return xchainAsset.shadow;
    });

    return { xchain: xchainAssetsInfo, nervos: nervosAssetsInfo };
  });

  return useQuery(
    ['getAssetBalance', { network, direction }],
    async (): Promise<Assets> => {
      if (!signer) boom('signer is not found when fetching balance');
      if (!infos) boom('asset list is not loaded');

      const infoToBalancePayload = ({ network, ident }: { network: string; ident: string }) => ({
        network,
        assetIdent: ident,
        userIdent: signer.identityXChain(),
      });

      const xchainBalances = await api.getBalance(infos.xchain.map(infoToBalancePayload));
      const nervosBalances = await api.getBalance(infos.nervos.map(infoToBalancePayload));

      return {
        xchain: xchainBalances.map<Asset>((balance, i) => {
          const asset = infos.xchain[i];
          asset.setAmount(balance.amount);
          return asset;
        }),
        nervos: nervosBalances.map<NervosSUDT>((balance, i) => {
          const asset = infos.nervos[i];
          asset.setAmount(balance.amount);
          return asset;
        }),
      };
    },
    { enabled: signer != null && infos != null },
  );
}
