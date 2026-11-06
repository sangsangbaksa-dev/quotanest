# 배포 직전 준비 — quotanest

이 문서는 배포 파일의 빌드와 검증 절차를 설명합니다. Git에 연결된 호스팅 설정에 따라 브랜치 푸시나 `main` 머지가 자동 빌드 또는 배포를 시작할 수 있으므로 실제 호스팅 계정에서 상태를 확인하세요.

## 이번 변경

언어를 바꾸면 JSON 가져오기 입력창이 사라지던 문제를 수정했습니다. 인라인 스타일을 CSS로 옮겨 CSP 차단을 없앴고, 입력 레이블을 연결했습니다. 실제 JSON 가져오기 회귀 검사를 추가했습니다.

공통으로 단위 테스트, 공개 파일 빌드, 로컬 링크·출력 폴더 검증, 운영 CSP를 적용한 브라우저 검사, 배포 없는 GitHub Actions 검증을 추가했습니다. `404.html`이 없는 정적 앱을 Cloudflare Pages가 SPA로 처리해 잘못된 주소에도 200을 반환하는 동작을 방지합니다.

## 다른 컴퓨터에서 재현

```sh
git clone --branch codex/predeploy-2026-11-06 https://github.com/sangsangbaksa-dev/quotanest.git
cd quotanest
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run bundle
```

Node.js 22 이상을 사용합니다. `npm ci`는 고정된 개발용 도구 버전을 설치합니다. 로컬 Chromium을 사용하려면 `BROWSER_EXECUTABLE_PATH`를 실행 파일 경로로 지정할 수 있습니다.

- `npm run check`: 단위 테스트 → 공개 파일 빌드 → 로컬 링크와 비공개 파일 혼입 검사.
- `npm run test:browser`: dist를 로컬 HTTP로 열고 CSP, 모바일/데스크톱, 접근성 및 앱별 주요 흐름을 확인합니다. 실제 API 호출·계정 생성·구매는 하지 않습니다.
- `FULL_AUDIT=1 npm run test:browser`: 지원 언어, 360/390/768/1280px, light/dark, 서울/뉴욕/오클랜드 시간대를 조합해 검사합니다.
- 결과: `artifacts/browser/<engine>/report.json`, 스크린샷. 이 폴더와 `dist/`는 Git에 포함하지 않습니다.

## 배포 파일

`npm run bundle`은 공개 정적 파일에 Cloudflare Pages Functions를 로컬 컴파일해 `dist/_worker.js/`와 `dist/_routes.json`을 추가합니다. 함수와 종속 모듈을 빠뜨리지 않은 단일 `dist/`를 얻습니다. 컴파일은 업로드·프로젝트 생성·배포를 하지 않습니다. `/api/license`만 Worker로 연결하며 나머지는 정적 파일입니다.

`npm run build`는 정적 파일만 만듭니다. 정적 빌드를 다시 실행하면 기존 함수 결과도 지워지므로, 최종 배포 파일은 반드시 `npm run bundle`로 다시 만드세요. `scripts/check-dist.mjs`는 정적 링크와 노출 경계를 검사하며, API 응답은 단위 테스트와 별도 로컬 Pages 런타임으로 검증합니다.

GitHub Actions의 **Verify deployment bundle**은 테스트와 파일 생성만 수행합니다. Cloudflare 인증 정보를 읽지 않으며 배포 단계가 없습니다. Actions 결과물은 14일간 보관됩니다. 기존 **Deploy to Cloudflare Pages**는 수동 실행용으로 유지했습니다. 이번 작업에서 실행하지 않았습니다.

## 실제 배포 전에 남은 확인

- 대상 Cloudflare 계정과 Pages 프로젝트, 연결할 도메인·주소를 소유자가 확인해야 합니다. 토큰이나 계정 ID를 코드에 넣지 마세요.
- 이번 검증은 로컬 환경과 고정된 테스트 데이터 기준입니다. 프로덕션 사용자 데이터, 실제 계정 인증, 실제 구매·환불을 검증한 것은 아닙니다.
- 판매를 켜기 전 해당 앱의 `LEMONSQUEEZY_PRODUCT_ID`를 지정해 다른 상품의 키가 통과하지 않게 하세요. `LEMONSQUEEZY_DISABLED=1`은 로컬 테스트용입니다. 운영 모드와 구매 링크·가격·지원 이메일을 별도로 확인하세요.
- 구매 링크 또는 가격이 비어 있으면 판매 전 상태입니다. 상품명·도메인 확정도 배포 전에 확인하세요.

## 브라우저 엔진 검증

기본 `npm run test:browser`는 Chromium으로 실행합니다. `npx playwright install firefox webkit`과 해당 OS 종속성을 준비한 뒤 `BROWSER_ENGINE=firefox npm run test:browser` 또는 `BROWSER_ENGINE=webkit npm run test:browser`로 같은 회귀 흐름을 검사합니다. 결과는 `artifacts/browser/<engine>/`에 저장됩니다. WebKit은 Safari 및 실제 iOS 기기 검증을 대신하지 않습니다. 클립보드 권한 자동 허용은 Chromium에서만 사용하므로 다른 엔진의 모든 클립보드 동작을 검증했다고 해석하지 마세요.

WebKit 검사는 CSP 오류의 원인이 되는 Playwright의 임시 스크린샷 스타일 삽입을 피하기 위해 스크린샷을 생략합니다. 접근성·레이아웃·기능 검사는 그대로 실행하며 보안 정책 오류를 무시하지 않습니다. 화면 캡처는 Chromium·Firefox 결과를 사용합니다.
