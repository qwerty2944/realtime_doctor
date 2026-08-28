'use client';

/** 2단계: 이름, 생년월일, 선택 입력인 병원 등록번호. */

import { useState, type FormEvent } from 'react';

import {
  normalizeBirthDateInput,
  toIsoBirthDate,
  validateBirthDate
} from '@/lib/intake/birthDate';

import { Button, ErrorNotice, TextField } from './ui';

export interface PatientInfo {
  name: string;
  birthDate: string;
  registrationNo: string;
}

export interface PatientInfoStepProps {
  /**
   * 개인 링크에 묶여 미리 등록된 이름 (0019). 없으면 빈 칸에서 시작한다.
   *
   * 읽기 전용으로 두지 않는다: 접수 입력이 틀렸다면 본인이 더 정확하고,
   * 고칠 수 없는 칸은 틀린 이름을 그대로 차트에 남긴다.
   */
  initialName?: string | null;
  submitting: boolean;
  /** /api/intake/start 의 서버측 실패. 이미 한국어다. */
  serverError: string | null;
  onSubmit: (info: PatientInfo) => void;
}

export default function PatientInfoStep({
  initialName,
  submitting,
  serverError,
  onSubmit
}: PatientInfoStepProps) {
  const [name, setName] = useState(initialName?.trim() ?? '');
  // 숫자만("19540309"). 제출 시점에 ISO yyyy-mm-dd 로 바꾼다.
  const [birthDigits, setBirthDigits] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [birthError, setBirthError] = useState<string | null>(null);

  // YYYY-MM-DD 생년월일 문자열과 사전순으로 비교 가능하다.
  const today = new Date().toISOString().slice(0, 10);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = name.trim();
    let valid = true;

    if (trimmedName === '') {
      setNameError('이름을 입력해 주세요.');
      valid = false;
    } else {
      setNameError(null);
    }

    const birthProblem = validateBirthDate(birthDigits, today);
    setBirthError(birthProblem);
    if (birthProblem !== null) valid = false;

    if (!valid) return;

    onSubmit({
      name: trimmedName,
      birthDate: toIsoBirthDate(birthDigits),
      registrationNo: registrationNo.trim()
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold text-slate-900">환자 정보</h1>
        <p className="text-xl leading-relaxed text-slate-600">
          진료 기록을 연결하기 위해 필요합니다.
          {initialName?.trim()
            ? ' 접수처에서 등록한 이름이 미리 채워져 있습니다. 다르면 고쳐 주세요.'
            : ''}
        </p>
      </header>

      <div className="flex flex-col gap-6">
        <TextField
          label="이름"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={60}
          error={nameError ?? undefined}
        />

        <TextField
          label="생년월일"
          required
          value={birthDigits}
          onChange={(event) => setBirthDigits(normalizeBirthDateInput(event.target.value))}
          inputMode="numeric"
          autoComplete="bday"
          placeholder="19540309"
          // maxLength 를 일부러 두지 않는다: 브라우저가 붙여넣기에도 적용해서
          // "1954-03-09"(10자) 가 "1954-03-" 로 잘린 뒤에야
          // normalizeBirthDateInput 이 돌게 된다. 헬퍼가 이미 8자리로 자른다.
          hint="숫자 8자리만 입력해 주세요. (예: 19540309)"
          error={birthError ?? undefined}
        />

        <TextField
          label="병원 등록번호 (선택)"
          value={registrationNo}
          onChange={(event) => setRegistrationNo(event.target.value)}
          inputMode="numeric"
          maxLength={40}
          hint="모르시면 비워 두셔도 됩니다. 접수처에서 확인해 드립니다."
        />
      </div>

      {serverError ? <ErrorNotice>{serverError}</ErrorNotice> : null}

      <Button type="submit" loading={submitting}>
        문진 시작하기
      </Button>
    </form>
  );
}
