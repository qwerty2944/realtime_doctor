import axios from 'axios';

const ENDPOINT = 'https://naveropenapi.apigw.ntruss.com/recog/v1/stt';

export function hasClovaCredentials(): boolean {
  return !!(process.env.CLOVA_API_KEY_ID && process.env.CLOVA_API_KEY);
}

export async function transcribeWithClova(base64Wav: string): Promise<string> {
  const keyId = process.env.CLOVA_API_KEY_ID;
  const key = process.env.CLOVA_API_KEY;
  if (!keyId || !key) {
    throw new Error(
      'CLOVA 자격증명이 없습니다. .env에 CLOVA_API_KEY_ID, CLOVA_API_KEY를 설정하세요.'
    );
  }

  try {
    const buf = Buffer.from(base64Wav, 'base64');
    const { data } = await axios.post(`${ENDPOINT}?lang=Kor`, buf, {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': keyId,
        'X-NCP-APIGW-API-KEY': key,
        'Content-Type': 'application/octet-stream'
      },
      timeout: 30_000,
      maxBodyLength: 32 * 1024 * 1024
    });
    return typeof data?.text === 'string' ? data.text.trim() : '';
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response?.data;
      const detail =
        typeof body === 'string'
          ? body
          : body
            ? JSON.stringify(body)
            : err.message;
      throw new Error(
        `CLOVA STT error${status ? ` (${status})` : ''}: ${detail}`
      );
    }
    throw err;
  }
}
