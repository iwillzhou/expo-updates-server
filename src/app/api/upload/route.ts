import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    const form = await request.formData();
    const file = form.get('file') as File;
    const path = form.get('path') as string;
    const blob = await put(path, file, { access: 'public' });

    return NextResponse.json(blob);
}
