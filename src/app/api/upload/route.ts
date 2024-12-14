import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import tar from 'tar-stream';
import { put } from '@vercel/blob';
import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

// vercel 唯一可写的文件夹是 /tmp
const tmpDir = '/tmp';

export async function POST(request: NextRequest) {
    const headersList = await headers();

    const token = headersList.get('Authorization')?.split(' ')[1];
    if (!token) {
        return NextResponse.json({ error: 'Token is missing' }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get('file') as File;
    const pathPrefix = form.get('path') as string;

    if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!pathPrefix) {
        return NextResponse.json({ error: 'Path is missing' }, { status: 400 });
    }

    const updateBundlePath = `${pathPrefix}/${Math.floor(Date.now() / 1000)}`;

    try {
        // 保存上传的文件到本地
        const filePath = path.resolve(tmpDir, 'updates.tar.gz');
        const buffer = await file.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        // 确保解压目录存在
        const outputDir = path.resolve(tmpDir, 'output'); // 解压目标文件夹
        fs.mkdirSync(outputDir, { recursive: true });

        // 解压 tar.gz 文件
        const extract = tar.extract();
        extract.on('entry', (header, stream, next) => {
            const outputPath = path.join(outputDir, header.name);
            if (header.type === 'directory') {
                fs.mkdirSync(outputPath, { recursive: true });
            } else {
                const writeStream = fs.createWriteStream(outputPath);
                stream.pipe(writeStream);
            }
            stream.on('end', next);
            stream.resume();
        });

        // 使用 Promise 来确保解压完成后再返回响应
        const extractPromise = new Promise((resolve, reject) => {
            extract.on('finish', resolve); // 在解压完成时触发 resolve
            extract.on('error', reject); // 如果有错误，触发 reject
        });

        // 解压文件流
        const gzipStream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
        gzipStream.pipe(extract);

        // 等待解压完成
        await extractPromise;

        console.log('File extracted successfully!');

        // 获取解压后的文件夹中的所有文件
        const distDir = path.resolve(outputDir, 'dist');

        // 遍历 dist 目录中的所有文件和文件夹
        await traverseDir(distDir, '', token, updateBundlePath);

        // 删除临时文件和目录
        fs.rmSync(filePath);
        fs.rmSync(outputDir, { recursive: true, force: true });

        return NextResponse.json({ error: 'File uploaded and extracted successfully' }, { status: 200 });
    } catch (err) {
        console.error('Error during file processing:', err);
        return NextResponse.json({ error: 'Error processing file' }, { status: 500 });
    }
}

// 递归遍历目录，上传所有文件
async function traverseDir(currentDir: string, relativeDir: string, token: string, updateBundlePath: string) {
    const files = fs.readdirSync(currentDir); // 获取当前目录下的所有文件和文件夹

    for (const fileName of files) {
        const filePath = path.join(currentDir, fileName); // 当前文件的绝对路径
        const stats = fs.statSync(filePath); // 获取文件或文件夹的信息

        if (stats.isDirectory()) {
            // 如果是文件夹，递归遍历该文件夹
            const newRelativeDir = path.join(relativeDir, fileName); // 保留相对路径
            await traverseDir(filePath, newRelativeDir, token, updateBundlePath); // 递归遍历
        } else {
            // 如果是文件，上传文件
            await uploadFile(filePath, relativeDir, fileName, token, updateBundlePath);
        }
    }
}

// 上传文件到 Vercel Blob Storage
async function uploadFile(
    filePath: string,
    relativeDir: string,
    fileName: string,
    token: string,
    updateBundlePath: string
) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        // dist根目录下的文件放到updateBundlePath下，其他都放到根目录下方便复用
        const targetPath = `${relativeDir || updateBundlePath}/${fileName}`;
        const blob = await put(targetPath, fileBuffer, {
            access: 'public',
            addRandomSuffix: false,
            token
        });
        console.log(`File uploaded successfully: ${fileName}`, blob);
    } catch (err) {
        console.error(`Failed to upload ${fileName}:`, err);
        throw new Error(`Failed to upload ${fileName}`);
    }
}
