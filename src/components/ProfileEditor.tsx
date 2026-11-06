"use client";

import { useRef, useState } from "react";
import { saveProfile as saveAccountProfile } from "@/lib/account/client";
import type { PublicAccount } from "@/lib/account/shared";
import { datingApi, photoUrl, shrinkPhoto } from "@/lib/dating/client";
import {
  ADULT_AGE,
  AGE_MAX,
  GENDERS,
  PHOTOS_MAX,
  REGIONS,
  REGION_LABEL,
  type DatingProfile,
  type Gender,
  type Region,
} from "@/lib/dating/rules";
import { Button, Chip, ErrorLine, Field, Icon, inputClass } from "./ui";

const GENDER_LABEL: Record<Gender, string> = { m: "남성", f: "여성" };

/**
 * 프로필 만들기·고치기. 닉네임·소개는 원본 계정(account/profile), 나머지는 데이팅 프로필(api/dating).
 * 사진은 프로필을 한 번 저장한 뒤에 붙는다(datingStore.addPhoto).
 */
export function ProfileEditor({
  account,
  profile,
  onSaved,
  first,
}: {
  account: PublicAccount;
  profile: DatingProfile | null;
  onSaved: (profile: DatingProfile) => void;
  first?: boolean;
}) {
  const thisYear = new Date().getFullYear();
  const [nickname, setNickname] = useState(account.profile.nickname);
  const [bio, setBio] = useState(account.profile.bio);
  const [gender, setGender] = useState<Gender | null>(profile?.gender ?? null);
  const [birthYear, setBirthYear] = useState<number>(profile?.birthYear ?? thisYear - 28);
  const [region, setRegion] = useState<Region>(profile?.region ?? "seoul");
  const [wantGenders, setWantGenders] = useState<Gender[]>(profile?.want.genders ?? []);
  const [ageMin, setAgeMin] = useState(profile?.want.ageMin ?? 20);
  const [ageMax, setAgeMax] = useState(profile?.want.ageMax ?? 40);
  const [wantRegions, setWantRegions] = useState<Region[]>(profile?.want.regions ?? []);
  const [visible, setVisible] = useState(profile?.visible ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const years = Array.from({ length: AGE_MAX - ADULT_AGE + 1 }, (_, i) => thisYear - ADULT_AGE - i);
  const canSave = Boolean(nickname.trim() && gender);

  async function save() {
    if (!gender) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveAccountProfile({ nickname: nickname.trim(), bio: bio.trim() });
      const result = await datingApi.save({
        gender,
        birthYear,
        region,
        want: { genders: wantGenders.length ? wantGenders : [gender === "m" ? "f" : "m"], ageMin, ageMax, regions: wantRegions },
        visible,
      });
      onSaved(result.profile);
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onSaved((await datingApi.photoAdd(await shrinkPhoto(file))).profile);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function photoAction(version: string, makeMain: boolean) {
    setBusy(true);
    setError(null);
    try {
      onSaved((makeMain ? await datingApi.photoOrder([version]) : await datingApi.photoRemove(version)).profile);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className="space-y-7">
      {profile && (
        <section aria-label="사진">
          <div className="grid grid-cols-3 gap-2">
            {profile.photos.map((version, index) => (
              <div key={version} className={`relative overflow-hidden rounded-2xl bg-surface ${index === 0 ? "col-span-2 row-span-2" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl(account.id, version)} alt="" className="aspect-[3/4] h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5">
                  {index > 0 && (
                    <button className="rounded-full bg-black/50 px-2 py-1 text-[12px]" onClick={() => photoAction(version, true)} disabled={busy}>
                      대표로
                    </button>
                  )}
                  <button aria-label="사진 지우기" className="rounded-full bg-black/50 p-1" onClick={() => photoAction(version, false)} disabled={busy}>
                    <Icon.close className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {profile.photos.length < PHOTOS_MAX && (
              <button
                aria-label="사진 더하기"
                className={`flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed border-line text-muted hover:text-ink ${
                  profile.photos.length === 0 ? "col-span-2 row-span-2" : ""
                }`}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Icon.plus className="h-7 w-7" />
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void addPhoto(e.target.files?.[0])} />
        </section>
      )}

      <section className="space-y-4">
        <Field label="닉네임">
          <input className={inputClass} maxLength={20} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <Field label="소개">
          <textarea className={`${inputClass} min-h-24 resize-none`} maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label="성별">
          <div className="flex gap-2">
            {GENDERS.map((g) => (
              <Chip key={g} on={gender === g} onClick={() => setGender(g)}>
                {GENDER_LABEL[g]}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="태어난 해">
            <select className={inputClass} value={birthYear} onChange={(e) => setBirthYear(Number(e.target.value))}>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </Field>
          <Field label="지역">
            <select className={inputClass} value={region} onChange={(e) => setRegion(e.target.value as Region)}>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-[22px]">만나고 싶은 사람</h2>
        <Field label="성별">
          <div className="flex gap-2">
            {GENDERS.map((g) => (
              <Chip key={g} on={wantGenders.includes(g)} onClick={() => setWantGenders(toggle(wantGenders, g))}>
                {GENDER_LABEL[g]}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label={`나이 ${ageMin}–${ageMax}세`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={ADULT_AGE}
              max={AGE_MAX}
              value={ageMin}
              onChange={(e) => setAgeMin(Math.min(Number(e.target.value), ageMax))}
              className="w-full accent-marigold"
              aria-label="최소 나이"
            />
            <input
              type="range"
              min={ADULT_AGE}
              max={AGE_MAX}
              value={ageMax}
              onChange={(e) => setAgeMax(Math.max(Number(e.target.value), ageMin))}
              className="w-full accent-marigold"
              aria-label="최대 나이"
            />
          </div>
        </Field>
        <Field label={wantRegions.length ? "지역" : "지역 · 전국"}>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((r) => (
              <Chip key={r} on={wantRegions.includes(r)} onClick={() => setWantRegions(toggle(wantRegions, r))}>
                {REGION_LABEL[r]}
              </Chip>
            ))}
          </div>
        </Field>
        {!first && (
          <label className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
            <span className="text-[15px]">추천에 내 프로필 보이기</span>
            <input type="checkbox" className="h-5 w-5 accent-marigold" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          </label>
        )}
      </section>

      <ErrorLine error={error} />
      <Button className="w-full" disabled={busy || !canSave} onClick={() => void save()}>
        {first && !profile ? "다음" : saved ? "저장됨" : "저장"}
      </Button>
    </div>
  );
}
