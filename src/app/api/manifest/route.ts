import FormData from 'form-data';
import { list } from '@vercel/blob';
import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
    getAssetMetadataAsync,
    getMetadataAsync,
    convertSHA256HashToUUID,
    getExpoConfigAsync,
    getLatestUpdateBundlePathForRuntimeVersionAsync,
    createRollBackDirectiveAsync,
    NoUpdateAvailableError,
    createNoUpdateAvailableDirectiveAsync
} from '@/helpers';

export async function GET(request: NextRequest) {
    const headersList = await headers();
    const searchParams = request.nextUrl.searchParams;

    const projectId = searchParams.get('id');
    if (!projectId || typeof projectId !== 'string') {
        return NextResponse.json({ error: 'No id provided.' }, { status: 400 });
    }

    const channel = searchParams.get('channel') || '';
    if (!['staging', 'production'].includes(channel)) {
        return NextResponse.json({ error: 'No channel provided.' }, { status: 400 });
    }

    const protocolVersionMaybeArray = headersList.get('expo-protocol-version');
    if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
        return NextResponse.json({ error: 'Unsupported protocol version. Expected either 0 or 1.' }, { status: 400 });
    }

    const protocolVersion = parseInt(protocolVersionMaybeArray ?? '0', 10);

    const platform = headersList.get('expo-platform') ?? searchParams.get('platform');
    if (platform !== 'ios' && platform !== 'android') {
        return NextResponse.json({ error: 'Unsupported platform. Expected either ios or android.' }, { status: 400 });
    }

    const runtimeVersion = headersList.get('expo-runtime-version') ?? searchParams.get('runtime-version');
    if (!runtimeVersion || typeof runtimeVersion !== 'string') {
        return NextResponse.json({ error: 'No runtimeVersion provided.' }, { status: 400 });
    }

    let updateBundlePath: string;
    try {
        updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(
            projectId,
            channel,
            platform,
            runtimeVersion
        );
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const updateType = await getTypeOfUpdateAsync(updateBundlePath);

    try {
        try {
            if (updateType === UpdateType.NORMAL_UPDATE) {
                return await putUpdateInResponseAsync(updateBundlePath, runtimeVersion, platform, protocolVersion);
            } else if (updateType === UpdateType.ROLLBACK) {
                return await putRollBackInResponseAsync(updateBundlePath, protocolVersion);
            }
        } catch (maybeNoUpdateAvailableError) {
            if (maybeNoUpdateAvailableError instanceof NoUpdateAvailableError) {
                return await putNoUpdateAvailableInResponseAsync(protocolVersion);
            }
            throw maybeNoUpdateAvailableError;
        }
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error }, { status: 404 });
    }
}

enum UpdateType {
    NORMAL_UPDATE,
    ROLLBACK
}

// TODO: 待测试
async function getTypeOfUpdateAsync(updateBundlePath: string): Promise<UpdateType> {
    const { blobs } = await list({ prefix: updateBundlePath });
    const directoryContents = blobs.map(blob => blob.pathname);
    return directoryContents.includes('rollback') ? UpdateType.ROLLBACK : UpdateType.NORMAL_UPDATE;
}

async function putUpdateInResponseAsync(
    updateBundlePath: string,
    runtimeVersion: string,
    platform: string,
    protocolVersion: number
): Promise<NextResponse> {
    const headersList = await headers();

    const currentUpdateId = headersList.get('expo-current-update-id');
    const { metadataJson, createdAt, id } = await getMetadataAsync({
        updateBundlePath,
        runtimeVersion
    });

    // NoUpdateAvailable directive only supported on protocol version 1
    // for protocol version 0, serve most recent update as normal
    if (currentUpdateId === convertSHA256HashToUUID(id) && protocolVersion === 1) {
        throw new NoUpdateAvailableError();
    }

    const expoConfig = await getExpoConfigAsync({
        updateBundlePath,
        runtimeVersion
    });
    const platformSpecificMetadata = metadataJson.fileMetadata[platform];
    const manifest = {
        id: convertSHA256HashToUUID(id),
        createdAt,
        runtimeVersion,
        assets: await Promise.all(
            (platformSpecificMetadata.assets as any[]).map((asset: any) =>
                getAssetMetadataAsync({
                    updateBundlePath,
                    filePath: asset.path,
                    ext: asset.ext,
                    runtimeVersion,
                    platform,
                    isLaunchAsset: false
                })
            )
        ),
        launchAsset: await getAssetMetadataAsync({
            updateBundlePath,
            filePath: platformSpecificMetadata.bundle,
            isLaunchAsset: true,
            runtimeVersion,
            platform,
            ext: null
        }),
        metadata: {},
        extra: {
            expoClient: expoConfig
        }
    };

    const signature = null;
    // const expectSignatureHeader = headersList.get('expo-expect-signature');
    // if (expectSignatureHeader) {
    //     const privateKey = await getPrivateKeyAsync();
    //     if (!privateKey) {
    //         return NextResponse.json(
    //             { error: 'Code signing requested but no key supplied when starting server.' },
    //             { status: 400 }
    //         );
    //     }
    //     const manifestString = JSON.stringify(manifest);
    //     const hashSignature = signRSASHA256(manifestString, privateKey);
    //     const dictionary = convertToDictionaryItemsRepresentation({
    //         sig: hashSignature,
    //         keyid: 'main'
    //     });
    //     signature = serializeDictionary(dictionary);
    // }

    const assetRequestHeaders: { [key: string]: object } = {};
    [...manifest.assets, manifest.launchAsset].forEach(asset => {
        assetRequestHeaders[asset.key] = {
            'test-header': 'test-header-value'
        };
    });

    const form = new FormData();
    form.append('manifest', JSON.stringify(manifest), {
        contentType: 'application/json',
        header: {
            'content-type': 'application/json; charset=utf-8',
            ...(signature ? { 'expo-signature': signature } : {})
        }
    });
    form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
        contentType: 'application/json'
    });

    return new NextResponse(form.getBuffer(), {
        status: 200,
        headers: {
            'expo-protocol-version': `${protocolVersion}`,
            'expo-sfv-version': '0',
            'cache-control': 'private, max-age=0',
            'content-type': `multipart/mixed; boundary=${form.getBoundary()}`
        }
    });
}

async function putRollBackInResponseAsync(updateBundlePath: string, protocolVersion: number): Promise<NextResponse> {
    if (protocolVersion === 0) {
        throw new Error('Rollbacks not supported on protocol version 0');
    }

    const headersList = await headers();

    const embeddedUpdateId = headersList.get('expo-embedded-update-id');
    if (!embeddedUpdateId || typeof embeddedUpdateId !== 'string') {
        throw new Error('Invalid Expo-Embedded-Update-ID request header specified.');
    }

    const currentUpdateId = headersList.get('expo-current-update-id');
    if (currentUpdateId === embeddedUpdateId) {
        throw new NoUpdateAvailableError();
    }

    const directive = await createRollBackDirectiveAsync(updateBundlePath);

    const signature = null;
    // const expectSignatureHeader = headersList.get('expo-expect-signature');
    // if (expectSignatureHeader) {
    //     const privateKey = await getPrivateKeyAsync();
    //     if (!privateKey) {
    //         return NextResponse.json(
    //             { error: 'Code signing requested but no key supplied when starting server.' },
    //             { status: 400 }
    //         );
    //     }
    //     const directiveString = JSON.stringify(directive);
    //     const hashSignature = signRSASHA256(directiveString, privateKey);
    //     const dictionary = convertToDictionaryItemsRepresentation({
    //         sig: hashSignature,
    //         keyid: 'main'
    //     });
    //     signature = serializeDictionary(dictionary);
    // }

    const form = new FormData();
    form.append('directive', JSON.stringify(directive), {
        contentType: 'application/json',
        header: {
            'content-type': 'application/json; charset=utf-8',
            ...(signature ? { 'expo-signature': signature } : {})
        }
    });

    return new NextResponse(form.getBuffer(), {
        status: 200,
        headers: {
            'expo-protocol-version': '1',
            'expo-sfv-version': '0',
            'cache-control': 'private, max-age=0',
            'content-type': `multipart/mixed; boundary=${form.getBoundary()}`
        }
    });
}

async function putNoUpdateAvailableInResponseAsync(protocolVersion: number): Promise<NextResponse> {
    if (protocolVersion === 0) {
        throw new Error('NoUpdateAvailable directive not available in protocol version 0');
    }

    const directive = await createNoUpdateAvailableDirectiveAsync();

    const signature = null;
    // const expectSignatureHeader = headersList.get('expo-expect-signature');
    // if (expectSignatureHeader) {
    //     const privateKey = await getPrivateKeyAsync();
    //     if (!privateKey) {
    //         return NextResponse.json(
    //             { error: 'Code signing requested but no key supplied when starting server.' },
    //             { status: 400 }
    //         );
    //     }
    //     const directiveString = JSON.stringify(directive);
    //     const hashSignature = signRSASHA256(directiveString, privateKey);
    //     const dictionary = convertToDictionaryItemsRepresentation({
    //         sig: hashSignature,
    //         keyid: 'main'
    //     });
    //     signature = serializeDictionary(dictionary);
    // }

    const form = new FormData();
    form.append('directive', JSON.stringify(directive), {
        contentType: 'application/json',
        header: {
            'content-type': 'application/json; charset=utf-8',
            ...(signature ? { 'expo-signature': signature } : {})
        }
    });

    return new NextResponse(form.getBuffer(), {
        status: 200,
        headers: {
            'expo-protocol-version': '1',
            'expo-sfv-version': '0',
            'cache-control': 'private, max-age=0',
            'content-type': `multipart/mixed; boundary=${form.getBoundary()}`
        }
    });
}
