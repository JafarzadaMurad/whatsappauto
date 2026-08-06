# Lider ⇄ Chatbot inteqrasiyası

Lider komandası üçün. Aşağıdakıların hamısı işlək vəziyyətdədir:
`https://chatbot.tural.ai/api/partner/lider`

## İş bölgüsü

Müştərinin pulu Liderdədir. Balansın kifayət edib-etmədiyinə **Lider**
qərar verir və məbləği **Lider** çıxır. Chatbot həmin balansın nüsxəsini
saxlamır — kiminsə pulunun ikinci nüsxəsi yalnız üzləşdirmə problemi
yaradır və o problem ən pis anda üzə çıxır.

Yəni axın həmişə belədir:
**Lider yoxlayır → Lider çıxır → Lider chatbota nə tətbiq ediləcəyini
deyir → chatbot tətbiq edir və nəticəni qaytarır.**

Chatbot sorğusu xəta qaytarsa, Lider tutulan məbləği geri qaytarmalıdır.
Timeout olsa, **eyni `transactionId` ilə** yenidən göndərin (aşağıdakı
İdempotentlik bölməsinə bax).

## Autentifikasiya

Hər partnyor sorğusunda paylaşılan açar göndərilir:

```
Authorization: Bearer <LIDER_API_KEY>
```

Açarı chatbot admini Admin → Payments bölməsində təyin edir və sizə
ayrıca kanalla ötürür. Müqayisə sabit vaxtda aparılır; səhv açar `401`
və `{"code":"unauthorized"}` qaytarır.

## İdempotentlik

`POST /purchase/plan` və `POST /purchase/credits` sorğularının hər ikisi
`transactionId` tələb edir — bu, **Liderin öz əməliyyat id-sidir** və
bazada unikal saxlanılır.

- Birinci çağırış: alışı tətbiq edir, `applied: true` qaytarır.
- Hər təkrar çağırış: heç nə dəyişmir, `alreadyApplied: true` qaytarır.

Təkrar göndərməni məhz bu təhlükəsiz edir. **Təkrar üçün yeni id
yaratmayın** — o halda plan iki dəfə verilər.

## Hesabın qoşulması

Alış baş verməzdən əvvəl chatbot istifadəçisi ilə Lider istifadəçisinin
eyni şəxs olduğu sübut olunmalıdır. Heç bir tərəf OAuth server qurmur —
sual əslində birdir, ona görə birdəfəlik token kifayətdir.

1. İstifadəçi chatbot billing səhifəsində **Connect Lider** düyməsini basır.
2. Chatbot token yaradır (15 dəqiqə, birdəfəlik) və istifadəçini sizin
   **Lider Connect URL**-inizə yönləndirir:
   `?token=<token>&return_url=<geri qayıdış ünvanı>`
3. Lider öz istifadəçisini adi qaydada tanıdır.
4. Lider server-server sorğu göndərir:

```http
POST /api/partner/lider/link
Authorization: Bearer <açar>
Content-Type: application/json

{ "token": "<query string-dən gələn>", "liderUserId": "12345", "liderEmail": "a@b.c" }
```

5. Chatbot hesabları bağlayır və tokeni yandırır. İstifadəçini
   `return_url` ünvanına geri göndərin.

Token sübut edir ki, **məhz həmin chatbot hesabı** qoşulmaq istəyib;
API açarı sübut edir ki, geri çağırış **həqiqətən Liderdəndir**. Tək
başına heç biri kifayət deyil.

Nəzərə alınmalı xətalar: `token_expired`, `token_used`, `already_linked`
(həmin Lider hesabı başqa bir chatbot hesabına bağlıdır).

## Endpoint-lər

### `GET /plans`

Alış ekranında göstəriləcəklər. Qiymətlər burada saxlanılır, ona görə
Liderin öz nüsxəsini sinxron saxlamasına ehtiyac yoxdur.

```json
{
  "success": true,
  "plans": [
    { "id": "uuid", "name": "Pro", "price": 49, "currency": "USD",
      "interval": "month", "monthlyCredits": 500000,
      "maxAgents": 5, "maxWhatsappAccounts": 3, "…": "…" }
  ],
  "credits": { "perUsd": 10000, "minimumUsd": 5 }
}
```

### `GET /account?liderUserId=12345`

Qoşulmuş hesabın hazırkı vəziyyəti — yüksəltmə təklif etməzdən əvvəl
"siz Pro plandasınız, 382,140 kredit qalıb" göstərmək üçün.

Hesablar heç vaxt qoşulmayıbsa `404 not_linked` qaytarır.

### `POST /purchase/plan`

```json
{ "liderUserId": "12345", "planId": "uuid", "amountUsd": 49, "transactionId": "LID-88213" }
```

Planı həm istifadəçiyə, həm də onun sahib olduğu **bütün
workspace-lərə** yazır — ödənilmiş imkanlar məhz bu səbəbdən işə düşür.

```json
{ "success": true, "applied": true, "userId": "uuid",
  "plan": { "id": "uuid", "name": "Pro", "price": 49, "monthlyCredits": 500000 } }
```

### `POST /purchase/credits`

```json
{ "liderUserId": "12345", "amountUsd": 25, "transactionId": "LID-88214" }
```

`workspaceId` istəyə bağlıdır — göndərməsəniz, kreditlər istifadəçinin
birinci workspace-inə düşür. Böyük əksəriyyətin bir dənə workspace-i
olduğu üçün düzgün cavab elə budur.

```json
{ "success": true, "applied": true, "credits": 250000, "workspaceId": "uuid" }
```

Kreditlər `GET /plans` cavabındakı `perUsd` kursu ilə verilir (hazırda
1 USD = 10,000 kredit). Ay sonunda yanmır.

## Xətalar

Bütün xətalar bu formatdadır:
`{ "success": false, "code": "...", "message": "..." }`

| code | status | mənası |
|---|---|---|
| `unauthorized` | 401 | açar yoxdur və ya səhvdir |
| `not_configured` | 503 | chatbot tərəfdə admin açarı təyin etməyib |
| `not_linked` | 404 | həmin `liderUserId` heç bir chatbot hesabına bağlı deyil |
| `no_plan` / `plan_inactive` | 404 / 400 | səhv `planId` |
| `no_workspace` | 404 | hesabın kredit yazılacaq workspace-i yoxdur |
| `bad_token` / `token_expired` / `token_used` | 404 / 400 | qoşulma addımı |
| `already_linked` | 409 | həmin Lider hesabı burada başqasına bağlıdır |

`message` insana göstərilmək üçün yazılıb; şərtlərinizdə `code`
üzərindən yoxlama aparın.

## Referal haqqında qeyd

Lider vasitəsilə edilən alış referala kart ödənişi ilə eyni komissiyanı
qazandırır. Əlavə heç nə göndərmək lazım deyil — pulun haradan gəldiyi
referalın işi deyil.
