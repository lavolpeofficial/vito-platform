import { NextResponse } from 'next/server';
import { getOperationsSummary } from '@/lib/operations/server';

export async function POST() {
  try {
    const summary = await getOperationsSummary();
    return NextResponse.json({ summary }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STATUS_UNAVAILABLE';
    return NextResponse.json({ message }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
