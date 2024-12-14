import mime from 'mime';
import path from 'path';
import { list, head } from '@vercel/blob';
import { Dictionary } from 'structured-headers';
import crypto, { BinaryToTextEncoding } from 'crypto';
import { fetchBufferFromVercelBlob, fetchJSONFromVercelBlob } from '@/helpers/vercel-blob';

export class NoUpdateAvailableError extends Error {}

function createHash(file: Buffer, hashingAlgorithm: string, encoding: BinaryToTextEncoding) {
    return crypto.createHash(hashingAlgorithm).update(file).digest(encoding);
}

function getBase64URLEncoding(base64EncodedString: string): string {
    return base64EncodedString.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function convertToDictionaryItemsRepresentation(obj: { [key: string]: string }): Dictionary {
    return new Map(
        Object.entries(obj).map(([k, v]) => {
            return [k, [v, new Map()]];
        })
    );
}

export function signRSASHA256(data: string, privateKey: string) {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data, 'utf8');
    sign.end();
    return sign.sign(privateKey, 'base64');
}

export async function getLatestUpdateBundlePathForRuntimeVersionAsync(
    projectId: string,
    channel: string,
    platform: string,
    runtimeVersion: string
) {
    const prefix = `${projectId}/${channel}/${platform}/${runtimeVersion}/`;
    const { folders } = await list({ mode: 'folded', prefix });
    if (folders.length === 0) {
        throw new Error('Unsupported runtime version');
    }
    const directoriesInUpdatesDirectory = folders
        .map(dir => dir.split('/').findLast(i => i !== ''))
        .filter(truthy)
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    return path.join(prefix, directoriesInUpdatesDirectory[0]);
}

type GetAssetMetadataArg =
    | {
          updateBundlePath: string;
          filePath: string;
          ext: null;
          isLaunchAsset: true;
          runtimeVersion: string;
          platform: string;
          id: string;
          channel: string;
      }
    | {
          updateBundlePath: string;
          filePath: string;
          ext: string;
          isLaunchAsset: false;
          runtimeVersion: string;
          platform: string;
          id: string;
          channel: string;
      };

export async function getAssetMetadataAsync(arg: GetAssetMetadataArg) {
    const assetFilePath = `${arg.filePath}`;
    const asset = await fetchBufferFromVercelBlob(assetFilePath);
    const assetHash = getBase64URLEncoding(createHash(asset, 'sha256', 'base64'));
    const key = createHash(asset, 'md5', 'hex');
    const keyExtensionSuffix = arg.isLaunchAsset ? 'bundle' : arg.ext;
    const contentType = arg.isLaunchAsset ? 'application/javascript' : mime.getType(arg.ext);

    return {
        hash: assetHash,
        key,
        fileExtension: `.${keyExtensionSuffix}`,
        contentType,
        url: `${process.env.HOSTNAME}/api/assets?asset=${assetFilePath}&runtimeVersion=${arg.runtimeVersion}&platform=${arg.platform}&id=${arg.id}&channel=${arg.channel}`
    };
}

export async function createRollBackDirectiveAsync(updateBundlePath: string) {
    try {
        const rollbackFilePath = `${updateBundlePath}/rollback`;
        const { uploadedAt } = await head(rollbackFilePath);
        return {
            type: 'rollBackToEmbedded',
            parameters: {
                commitTime: new Date(uploadedAt).toISOString()
            }
        };
    } catch (error) {
        throw new Error(`No rollback found. Error: ${error}`);
    }
}

export async function createNoUpdateAvailableDirectiveAsync() {
    return {
        type: 'noUpdateAvailable'
    };
}

export async function getMetadataAsync({
    updateBundlePath,
    runtimeVersion
}: {
    updateBundlePath: string;
    runtimeVersion: string;
}) {
    try {
        const metadataPath = `${updateBundlePath}/metadata.json`;
        const { uploadedAt } = await head(metadataPath);
        const metadataJson = await fetchJSONFromVercelBlob(metadataPath);
        const updateMetadataBuffer = await fetchBufferFromVercelBlob(metadataPath);

        return {
            metadataJson,
            createdAt: new Date(uploadedAt).toISOString(),
            id: createHash(updateMetadataBuffer, 'sha256', 'hex')
        };
    } catch (error) {
        throw new Error(`No update found with runtime version: ${runtimeVersion}. Error: ${error}`);
    }
}

/**
 * This adds the `@expo/config`-exported config to `extra.expoConfig`, which is a common thing
 * done by implementors of the expo-updates specification since a lot of Expo modules use it.
 * It is not required by the specification, but is included here in the example client and server
 * for demonstration purposes. EAS Update does something conceptually very similar.
 */
export async function getExpoConfigAsync({
    updateBundlePath,
    runtimeVersion
}: {
    updateBundlePath: string;
    runtimeVersion: string;
}): Promise<any> {
    try {
        const expoConfigPath = `${updateBundlePath}/expoConfig.json`;
        const expoConfigJson = await fetchJSONFromVercelBlob(expoConfigPath);
        return expoConfigJson;
    } catch (error) {
        throw new Error(`No expo config json found with runtime version: ${runtimeVersion}. Error: ${error}`);
    }
}

export function convertSHA256HashToUUID(value: string) {
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
        16,
        20
    )}-${value.slice(20, 32)}`;
}

export function truthy<TValue>(value: TValue | null | undefined): value is TValue {
    return !!value;
}
