import { put } from '@vercel/blob';
import { headers } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    const headersList = await headers();
    const authorizationHeader = headersList.get('Authorization');
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: 'Invalid or missing Authorization header' }, { status: 401 });
    }
    const token = authorizationHeader.split(' ')[1];
    if (!token) {
        return NextResponse.json({ error: 'Token is missing' }, { status: 401 });
    }
    const isValid = token === process.env.BLOB_READ_WRITE_TOKEN;
    if (!isValid) {
        return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get('file') as File;
    const path = form.get('path') as string;
    const blob = await put(path, file, {
        access: 'public',
        addRandomSuffix: false
    });

    return NextResponse.json(blob);
}
