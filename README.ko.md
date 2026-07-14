# GBrain 3D Memory Map

[English](README.md) | **한국어**

로컬 GBrain PostgreSQL·pgvector의 page를 읽기 전용 semantic map으로 보여주는 단일 화면 웹 앱입니다. 기본 3D map과 충돌 없는 전용 2D map을 전환할 수 있습니다. 브라우저는 Bun API만 호출하며 DB 자격 증명, 원본 embedding, 전체 본문은 받지 않습니다.

## 구성

- Vite + React + TypeScript + Tailwind CSS + shadcn/ui 방식의 UI 컴포넌트
- Three.js + `react-force-graph-3d`
- Bun API + PostgreSQL/pgvector
- `umap-js` 고정 seed 3D projection
- 실제 schema: `pages`, `content_chunks`, `links`, `tags`, `sources`

API는 다음 세 개뿐입니다.

```text
GET  /api/status
GET  /api/graph
POST /api/graph/rebuild
```

## 설정

```bash
cp .env.example .env
```

`.env`에 로컬 GBrain의 읽기 전용 계정을 입력합니다. `.env`는 Git에서 제외됩니다.

```dotenv
GBRAIN_DB_HOST=127.0.0.1
GBRAIN_DB_PORT=5432
GBRAIN_DB_NAME=gbrain
GBRAIN_DB_USER=<read-only-user>
GBRAIN_DB_PASSWORD=<secret>
GBRAIN_DB_SCHEMA=public
GBRAIN_ALLOWED_SOURCE_IDS=default

LEIDEN_RESOLUTION=0.5
LEIDEN_MIN_SEMANTIC_SIMILARITY=0.65
LEIDEN_SEED=84

APP_HOST=127.0.0.1
APP_PORT=3000
APP_PUBLIC_ORIGIN=
APP_REBUILD_MIN_INTERVAL_SECONDS=15

APP_AUTH_PASSWORD=<password>
APP_SESSION_SECRET=<at-least-32-random-characters>
APP_AUTH_SESSION_HOURS=12
APP_AUTH_MAX_ATTEMPTS=5
APP_AUTH_ATTEMPT_WINDOW_MINUTES=15
```

`GBRAIN_ALLOWED_SOURCE_IDS`는 쉼표로 구분합니다. 서버는 schema 식별자를 검증하고, source allowlist와 `deleted_at IS NULL` 조건을 모든 snapshot 쿼리에 적용합니다.

## 실행

```bash
bun install
bun run dev
```

개발 UI는 `http://127.0.0.1:5173`, API는 `http://127.0.0.1:3000`입니다. production 실행:

```bash
bun run build
bun run start
```

production에서는 Bun 서버가 `dist/`와 API를 같은 origin에서 제공합니다.

production 앱은 비밀번호 로그인으로 보호됩니다. 성공 시 Bun 서버가 서명된 HttpOnly 세션 쿠키를 발급하며, 공개 HTTPS에서는 `Secure`, 모든 환경에서 `SameSite=Strict`를 적용합니다. 비밀번호와 세션 서명 키는 브라우저나 image layer로 전달되지 않습니다. Vite 개발 서버는 loopback 개발 전용이며 인증 진입점을 검증하려면 production 방식으로 실행하십시오. 로그인 POST는 동일/설정 origin과 비신뢰 TLS 예외 페이지의 opaque `Origin: null`만 허용하며, 로그아웃과 graph rebuild는 계속 동일 origin만 허용합니다.

## Docker Compose 실행

현재 저장소의 `.env`에는 이전 GBrain Dashboard에서 사용하던 전용 읽기 전용 PostgreSQL 계정 설정이 split 환경변수 형식으로 들어갑니다. `.env`는 build context에서 제외되고 Git에도 포함되지 않습니다.

```bash
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:3100/healthz
```

기본 container port는 3000이고 host에는 `127.0.0.1:3100`으로 게시합니다. 이 호스트에서는 3000과 3200을 기존 서비스가 사용하고 있어 충돌을 피한 값입니다. 포트를 바꾸려면 `.env`의 `APP_PUBLISHED_PORT`만 변경합니다.

종료와 로그 확인:

```bash
docker compose logs -f web
docker compose down
```

Compose 서비스는 non-root user, read-only root filesystem, capability drop, `no-new-privileges`, 제한된 `/tmp` tmpfs로 실행됩니다. DB 자격 증명은 runtime environment로만 주입되며 image layer에는 복사되지 않습니다.

## 데이터 처리

1. `brain-map` 태그가 붙은 탐색용 메타 인덱스 page를 page·embedding·link query 단계에서 제외합니다. 원본 GBrain page는 변경하지 않습니다.
2. 각 chunk embedding에 PostgreSQL `l2_normalize()`를 적용합니다.
3. `avg()`로 page embedding을 만듭니다.
4. 같은 page vector CTE에서 pgvector cosine distance(`<=>`)로 page별 top-2 semantic edge를 생성합니다.
5. semantic edge와 explicit edge를 하나의 가중 undirected graph로 합칩니다. 양방향 semantic edge는 한 edge로 합치고 self-link는 community 계산에서 제외합니다.
6. Graphology 기반 Leiden을 고정 seed로 실행해 community를 만들고, community를 node color와 halo에 사용합니다.
7. page embedding은 별도의 고정 seed UMAP으로 3차원 projection해 표시 좌표를 만듭니다.
8. embedding이 없는 page도 explicit relation이 있으면 Leiden community에 포함하지만, 좌표는 기존처럼 외곽 outline-only 영역에 둡니다.

stable node ID는 `source_id::slug`입니다. explicit edge는 원래 `link_type`, `link_source`, 방향을 보존하지만 화면의 선은 모두 직선이며 화살표를 사용하지 않습니다. 방향은 hover tooltip의 `source → target`으로 확인합니다. 같은 node pair의 여러 관계는 가장 높은 우선순위 선 하나로 합치고 tooltip에 원래 관계를 모두 표시합니다.

상단 `Pages`와 `Chunks` 수치는 실제 DB 전체 수가 아니라 `brain-map` 메타 인덱스를 제외한 표시 대상 snapshot 기준입니다.

## 3D / 2D map 전환

상단 `2D map` 버튼은 단순히 기존 좌표의 Z축을 0으로 만들지 않습니다. 그렇게 하면 깊이로 분리됐던 node와 community가 평면에서 겹칠 수 있으므로 별도의 deterministic 2D layout을 계산합니다.

- 각 Leiden community 내부에서 billboard 시각 반지름의 합과 0.8 간격을 기준으로 2D node collision을 해소합니다.
- 각 community의 바깥 halo를 감싸는 원을 계산하고, 원 사이에 최소 14의 간격을 두는 별도 community packing을 수행합니다.
- 원래 3D 좌표의 등각 투영을 2D 초기 위치로 사용하므로 community의 대략적인 상대 방향을 유지합니다.
- unclassified와 embedding 없는 outline-only node는 packed community 전체 바깥의 충돌 없는 ring에 배치합니다.
- 동일한 stable node ID의 3D·2D 좌표를 1.05초 cubic ease-in-out으로 보간합니다. 전환 중 edge endpoint, halo 중심·반경, label anchor도 매 frame 함께 갱신됩니다.
- 전환 중에는 ForceGraph 전체 `refresh()`를 호출하지 않습니다. Node는 shape·color·size attribute를 가진 단일 point batch, semantic/explicit edge는 각각 단일 line batch, community halo는 inner/outer 두 개의 저폴리 merged mesh로 잠시 합쳐 draw call을 줄입니다. 전환 종료 후 원래 billboard, 굵은 relation line, halo hover object를 즉시 복원합니다.
- `nodeThreeObject`와 `linkThreeObject` accessor는 mode/resize render 사이에서 동일한 함수 identity를 유지합니다. 따라서 3D↔2D 전환만으로 ForceGraph가 기존 node/edge object를 교체하지 않으며, morph 시작점은 flatness 추정값이 아니라 현재 표시 좌표에서 직접 읽습니다.
- Community label 크기는 최초 한 번만 측정하고 이후 `translate3d()` compositor transform으로 이동합니다. 긴 browser stall은 제외한 morph FPS와 batch 적용 여부를 `data-morph-*` 진단 속성에 남깁니다.
- 2D mode에서는 camera를 평면 정면으로 이동하고 회전만 잠급니다. 확대와 이동, node/edge hover, 선택, community focus는 그대로 동작합니다.
- `3D map` 버튼으로 돌아오면 서버가 제공한 원래 UMAP·Leiden 3D 좌표와 등각 camera로 같은 방식으로 복원됩니다.

운영 graph를 대상으로 2D 최종 좌표의 node 표면 간격과 community halo 간격을 smoke test에서 전수 검사합니다. 2D layout은 브라우저 표현용이며 API 응답이나 GBrain DB에 좌표를 쓰지 않습니다.

관계선은 패턴과 굵기로 구분합니다.

| 관계 | 패턴 | 굵기 |
| --- | --- | ---: |
| Temporal evolution | 긴 파선 | 3.0px |
| Structure / dependency | 실선 | 2.6px |
| Provenance / evidence | 짧은 파선 | 2.0px |
| Association | 실선 | 1.6px |
| Mention / reference | 점선 | 1.1px |
| Semantic similarity | 실선 | 0.6px |

Leiden 입력에서 cosine similarity가 `LEIDEN_MIN_SEMANTIC_SIMILARITY`보다 낮은 semantic edge는 제외합니다. 유지된 semantic edge는 threshold에서 0.25, similarity 1에서 1.0이 되도록 선형 변환합니다. Explicit edge weight는 mention 0.35, association 0.9, hierarchy 1.4, provenance 1.25, temporal 1.1이며 같은 node pair의 증거는 합칩니다. 실제 DB matrix에서 기본 `resolution=0.5`, threshold 0.65는 seed 간 partition 일치도 99% 이상과 과도하지 않은 community 크기를 보였습니다.

관계가 하나도 남지 않은 page만 `unclassified`로 표시합니다. Tooltip의 `internal-edge share`는 해당 node의 전체 Leiden 입력 edge weight 중 같은 community로 연결된 weight 비율이며 Leiden membership probability는 아닙니다. Community 내부 3D UMAP 상대 좌표는 유지하면서 community centroid 간격과 node 최소 간격을 완화합니다. 각 community의 3D bounding volume에는 낮은 강도의 halo를 표시합니다. `Labels`를 켜면 개별 node 제목 대신 community당 하나의 label을 바깥 halo의 화면상 정중앙 최상단에 고정합니다. Label에는 `Leiden NN`과 node 수를 제외한 community 제목만 표시하며 `No retained relation` label은 숨깁니다. 기본 글자와 검정 배경은 낮은 opacity이고, pointer가 해당 3D halo 안에 들어오면 범위 변경 없이 halo가 밝아지며 그 group label은 완전 불투명 흰색으로 바뀝니다. Hover community의 모든 node와 explicit/semantic edge로 직접 연결된 1-hop node는 동일한 opacity와 1.1배 scale로 강조하고, 나머지 node·halo·label은 흐리게 표시합니다. Camera 이동 중 위치 갱신은 frame당 한 번으로 제한하고 정수 pixel에 맞춰 글자 떨림을 방지합니다.

노드는 3D solid mesh 대신 `THREE.Sprite` billboard로 렌더링합니다. 따라서 카메라를 회전해도 2D 도형의 정면이 항상 카메라를 향합니다.

| Page type | Billboard shape |
| --- | --- |
| `concept` | 원 |
| `project`, `project_note` | 사각형 |
| `note`, `analysis`, `guide` | 마름모 |
| `incident`, `incident-followup` | 삼각형 |
| `project-log`, `ops-snapshot`, `infrastructure-snapshot` | 육각형 |
| `extract_receipt` | 팔각형 |
| 알 수 없는 type | 오각형 |

도형은 의미 그룹 색상을 채우고 얇은 검정 테두리를 사용합니다. embedding이 없는 node는 채움 없는 점선 outline으로 표시합니다. 선택 node는 색을 유지하면서 흰색 outline과 1.12배 확대를 적용합니다. 기본 node 반지름 배율은 0.675로 이전 billboard의 정확히 절반입니다. layout은 각 node의 시각 반지름 합에 0.8의 간격을 더해 collision relaxation을 수행합니다. `No retained relation` node는 amber `#E8A838`로 표시하고, embedding 유무와 무관하게 중심에서 반경 약 68–76의 근접 ring에 균일하게 배치한 뒤 전체 node collision을 다시 완화합니다. 서로 다른 깊이의 billboard는 카메라 투영 방향에 따라 화면상 겹쳐 보일 수 있습니다.

## 읽기 전용과 외부 노출

앱은 snapshot 생성 시 `SET TRANSACTION READ ONLY`를 실행합니다. 운영 계정에도 대상 테이블의 SELECT만 부여하고 INSERT/UPDATE/DELETE는 부여하지 마십시오.

기본 `APP_HOST=127.0.0.1`은 의도된 설정입니다. 외부에 노출할 때 Bun을 직접 인터넷에 바인딩하지 말고, 같은 호스트의 리버스 프록시를 사용하십시오. 앱의 비밀번호 인증은 기본 방어선이며 리버스 프록시에서도 TLS를 반드시 적용하십시오. 더 강한 접근 통제가 필요하면 프록시 OIDC 또는 VPN을 함께 적용할 수 있습니다. graph snapshot 자체가 개인 메모리 메타데이터일 수 있으므로 `/api/status`, `/api/graph`, `/api/graph/rebuild`는 모두 로그인 세션이 필요합니다. 공개 `/healthz`는 상태 본문이나 DB 정보를 반환하지 않고 `ok`만 반환합니다.

Caddy 예시:

```caddyfile
memory.example.com {
  encode zstd gzip
  # 필요하면 forward_auth 또는 조직 OIDC를 추가
  reverse_proxy 127.0.0.1:3100
}
```

Nginx 예시:

```nginx
server {
  listen 443 ssl http2;
  server_name memory.example.com;

  # ssl_certificate / ssl_certificate_key 구성; 필요하면 auth_request 또는 VPN 추가
  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

외부 origin을 사용하면 `.env`에 `APP_PUBLIC_ORIGIN=https://memory.example.com`을 지정하십시오. 서버는 POST rebuild의 Origin을 검사하고 기본 15초 rate limit을 적용합니다. CSP, frame 차단, MIME sniffing 차단, referrer/permissions 정책과 HTTPS 전달 시 HSTS도 응답에 추가합니다.

## 테스트

```bash
bun test tests/community.test.ts tests/layout.test.ts tests/style.test.ts
APP_AUTH_PASSWORD='<configured-password>' SMOKE_BASE_URL=http://127.0.0.1:3000 bun test tests/smoke.test.ts
APP_AUTH_PASSWORD='<configured-password>' PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 bunx playwright test
```

실DB smoke test는 node/page 수, embedded/unembedded 분리, stable ID, semantic top-2, explicit edge 보존과 API의 민감 필드 미포함을 검사합니다. Playwright는 1440×1000, 1920×1200, 2560×1600에서 console error, failed request, 가로·세로 overflow를 검사하며 스크린샷과 분리한 순수 morph의 FPS를 `screenshots/morph-performance.json`에 기록합니다. 또한 React 좌표가 아니라 실제 Three.js scene node의 Z 깊이, node 좌표 오차, halo 중심·포함 범위 오차와 camera 축을 3D→2D→3D 전체 구간에서 검사합니다.

검토한 결과 이미지는 다음과 같습니다.

- [1440×1000](screenshots/gbrain-memory-map-1440x1000.png)
- [1920×1200](screenshots/gbrain-memory-map-1920x1200.png)
- [2560×1600](screenshots/gbrain-memory-map-2560x1600.png)
- [3D→2D morph](screenshots/gbrain-memory-map-3d-to-2d-morph.png)
- [2D final](screenshots/gbrain-memory-map-2d.png)

## 알려진 제한

- 좌표와 community는 프로세스 메모리에 cache되며 재시작 후 첫 요청에서 다시 계산됩니다.
- 고정 seed를 사용하지만 `umap-js` 버전 변경 시 layout이 달라질 수 있습니다.
- Leiden community label은 community의 우세 tag/type을 사용한 짧은 설명입니다.
- Leiden 결과는 semantic threshold, relation weight, resolution과 graph corpus 변경에 따라 달라질 수 있습니다.
- WebGL이 없는 브라우저를 위한 2D 대체 화면은 이번 단일 3D MVP 범위에 포함하지 않습니다.
- 단일 공유 비밀번호 방식이며 사용자별 계정, 권한 분리, 비밀번호 재설정 UI는 제공하지 않습니다.
