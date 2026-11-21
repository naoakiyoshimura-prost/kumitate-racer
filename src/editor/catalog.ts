// コースエディタの寸法表（実寸 mm / 度）。three に依存しない純粋なデータ。
// 出典の区別が最重要: official=メーカー公表（note に URL か「公式」）、measured=実測（店長の説明・第三者の実測。公式ではない）、
// estimated=公表値から計算（note に式）、provisional=仮の値。
// 3レーンと5レーンは別の表（3レーンの値を黙って流用しない）。5レーンは基本寸法だけ 2026-11-16 に決定、特殊な部品は provisional のまま。
import type { Dim, LaneCount } from './types';

const URL_LANE = 'https://tamiya.com/japan/products/69578/index.html';
const URL_WAVE = 'https://www.tamiya.com/japan/products/69575/index.html';
const URL_BASIC = 'https://tamiya.com/japan/mini4wd/feature/2019/1206.html';

const mm = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'mm', source, note });
const cnt = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'count', source, note });
const deg = (value: number, source: Dim['source'], note: string): Dim => ({ value, unit: 'deg', source, note });

// 3レーン
const L3_LANE = 115;
const L3_WALL_T = 10;
const L3_WIDTH = 3 * L3_LANE + 2 * L3_WALL_T; // 365
// コーナーの中心線の半径 = 直線1枚の長さ（540）。
// 理由: 実物は「直線○枚ぶん」の格子の上で組むので、90度（2枚）曲がったときの前後・左右のずれ（どちらも半径と同じ）が
// 直線1枚ぶんにならないと、90度の折れを混ぜた並びが閉じない。以前の 517.5（外寸 約1.4m と壁厚の仮値10mm からの逆算）では
// 例えば「直線2・左90・直線2・左180・右90・左180」が 63.6mm ずれて閉じなかった。
const L3_RADIUS = 540;

const UNCONFIRMED5 = '未確認。3レーンとは別に要調査';

export const CATALOG: Record<LaneCount, Record<string, Dim>> = {
  3: {
    laneWidth: mm(L3_LANE, 'official', `1レーンのコース幅 115mm。${URL_LANE}`),
    wallHeight: mm(50, 'official', `フェンス高 50mm。${URL_LANE}`),
    wallThickness: mm(L3_WALL_T, 'provisional', '仮。外側の壁1枚の厚み（未確認）'),
    straightLength: mm(540, 'provisional', '直線1枚 540mm（広く言われる値だが公式ページで未確認）'),
    cornerCenterRadius: mm(
      L3_RADIUS,
      'estimated',
      `直線1枚（540、仮）と同じ長さと推定。公式の公表値は無い。根拠: (1) 第三者の調査メモで中央レーンの中心の半径 540mm、` +
        `(2) 基本コースの公表の外寸 約3.1m×1.4m（${URL_BASIC}）と合う: 短辺 2×540 + 幅365 = 1445、長辺 直線3枚 1620 + 1445 = 3065、` +
        '(3) 公表「3周20m」と合う: 中心線1周 2×1620 + 2π×540 ≈ 6633、3周 ≈ 19.9m、' +
        '(4) 半径が直線1枚と同じだと、90度の折れを混ぜた並びが格子の上で閉じる（517.5 では閉じなかった）',
    ),
    cornerAngle: deg(45, 'provisional', '1枚45度として扱う（エディタの前提。公式ページで未確認）'),
    slopeRise: mm(110, 'measured', '落差11cm（店長の説明。公式の値とされるが出典のページは未確認なので公式扱いにしていない）'),
    slopeLength: mm(540, 'measured', '店長の説明: スロープの全長は直線1枚と同じ（上から見た長さ）。ただし直線1枚の540自体が仮の値（公式で未確認）'),
    slopeAngle: deg(15, 'estimated', '店長情報（伝聞、2026-11-12「スロープセクションは15度らしい」）。公式の値は見つからなかった。斜面（一定角度の所）の角度。110mm を 540mm で上がる平均の勾配は約11.5度'),
    slopeEntryFlat: mm(20, 'estimated', '店長の写真からの推定（2026-11-12「つなぎ目から20mmまっすぐ、そこから15度にぐっと曲がる」）。上りの登り口（下りなら下り口）のつなぎ目からの平らな長さ'),
    slopeBendRadius: mm(
      40,
      'estimated',
      '推定（公開値なし）。スロープの登り口の凹の丸み（平らから15度へ曲がる所、ブレーキが当たる所）の中心線の半径。店長「ぐっと曲がる」「進入の曲率が高いからブレーキがよく当たる」に合わせて小さめ。頂点側の凸の丸みは長さ・高さ・角度から計算で決まる（約790mm）。' +
        '2026-11-12: 300 → 80（前半で上がりきる形）→ 40（実物写真と15度に合わせた形）',
    ),
    bankAngle: deg(20, 'official', `バンクアプローチ1枚の角度 20度（公式の製品ページ。40度は20度を2枚重ねたもの＝店長の説明）。${URL_BASIC}`),
    bankBendRadius: mm(650, 'measured', '第三者の実測記事の値。公式ではない（アプローチ1枚は中心角20度の円弧で、弦の長さ 約226mm・半径 約650mm）'),
    waveLength: mm(540, 'provisional', '仮。直線1枚ぶんの長さと仮定'),
    waveSwing: mm(40, 'estimated', '2026-11-19 店長の上から見た図面（リポジトリ外）から読み取り: 1枚540mmの中で、両側の壁も仕切りもそろって片側へ約40mm（±5mm）ふくらんで戻る。路面は平らなまま、コースが左右に振れる部品'),
    waveCount: cnt(1, 'estimated', '2026-11-19 図面から読み取り: 1枚でふくらみ1つ（入口と出口はまっすぐ、真ん中で一番ずれる）'),
    laneChangeLength: mm(1620, 'measured', '店長の申告（2026-11-12）: 直線3本ぶん（540×3）。前後にLCジャンプのような坂が付き、その間を立体交差でつなぐ形（店長の説明）。坂と橋の長さの割合（1/3ずつ）は推定'),
    laneChangeRise: mm(110, 'measured', '店長 2026-11-20「LCの交差するところで110mmの高さに到達する」。それ以前: 店長情報（記憶、2026-11-12「レーンチェンジは一番高いところで100ミリのはず」）。立体交差の橋の一番高い所の路面の高さ。下のレーンの路面（床）から測る（他の部品と同じ基準）。公式の値は未確認。2026-11-12 に仮の70から変更'),
    bumpRise: mm(40, 'provisional', '仮。バウンド（片側がゆるく片側が急な山）の高さ。実物の公表値・実測値は見つからなかった'),
    bumpPeak: { value: 0.65, unit: 'count', source: 'provisional', note: '仮。バウンドの頂点の位置（部品の長さに対する割合。A の向きで入口から測る）' },
    tornadoRadiusMul: { value: 2, unit: 'count', source: 'estimated', note: '店長の指定（2026-11-21: トルネードバンクの半径は普通のコーナーの2倍）' },
    tornadoCant: deg(20, 'estimated', '店長の指定（2026-11-21: トルネードバンクのカント角20度）'),
    tornadoRise: mm(110, 'estimated', '店長の指定（2026-11-21: トルネードバンクは180度回ると110mm上がる）'),
    rollCant: deg(5, 'estimated', 'ローリングライズ・フォールのカント角（2026-11-21 店長「トルネードバンクの作りをぎゅっと濃縮した感じ」「カント角は5度」）'),
    rollRise: mm(110, 'estimated', '店長の指定（2026-11-21: ローリングライズ・フォールは45度曲がりながら110mm上がる・下がる）。実物の寸法は未確認'),
    steepRise: mm(220, 'estimated', '店長の指定（2026-11-12: スロープ2個ぶん=220mm 上がって水平）。実物の公表値・実測値は未確認'),
    steepAngle: deg(30, 'estimated', '店長の説明（30度バンクとその終わりを足したような形）から、斜面の角度を30度とした。丸みの半径（約297mm）は長さ・高さ・角度から計算した値で、実物は未確認'),
    humpRise: mm(45, 'provisional', '仮。こぶ（なめらかな山）の高さ。実物の公表値・実測値は見つからなかった'),
    shiftLength: mm(1390, 'estimated', '推定。シフトチェンジ全体の前への長さ（直線1枚 540 ＋ S字 約850）。店長の画面写し（参考ツールの2D表示）を直線1枚=540mmとして測った値'),
    shiftOffset: mm(230, 'estimated', '推定。シフトチェンジで横へずれる量（2レーンぶん）。店長の画面写しの目測は約235mm'),
    dropRise: mm(330, 'provisional', '仮。大坂の高さ（3段分）。3レーンの実物の値は見つからなかった。5レーンの「急な下り」に合わせて足した部品'),
    dropLength: mm(1080, 'provisional', '仮。大坂の上から見た長さ（直線2枚）'),
    dropAngle: deg(40, 'provisional', '仮。大坂の斜面の角度'),
    mtnRise: mm(330, 'provisional', '仮。大山の高さ（スロープ3段分）。3レーンの実物の値は無い。5レーンの660を直線の長さの比（540/1215）で縮めた約290に近い3段。660だと上りの頂上の丸みが小さくなり、ふつうの車が頂上で飛んで毎周コースアウトした（2026-11-16 試走）。設定値なので店長の体感で変える'),
    mtnUpLength: mm(1890, 'provisional', '仮。大山の上りの上から見た長さ（直線3.5枚。調査メモの読み: スロープ上り1枚＋橋1枚＋アプローチ1.5枚）'),
    mtnUpAngle: deg(20, 'provisional', '仮。大山の上りの斜面の角度（調査メモの読みで平均約16度）'),
    mtnDownLength: mm(1080, 'provisional', '仮。大山の下りの上から見た長さ（直線2枚。調査メモの読み 0.5〜1.5枚で図から読み切れない）'),
    mtnDownAngle: deg(45, 'provisional', '仮。大山の下りの斜面の角度（調査メモの読みで平均33〜60度）'),
    gapLength: mm(200, 'provisional', '仮。切れ目ジャンプの切れ目（5レーンの公表値200mmを仮置き）'),
    gapAngle: deg(5, 'provisional', '仮。切れ目ジャンプで頂上から飛び出す角度（頂上はほぼ水平なので小さめ。飛び方を見て調整）'),
    hopGap: mm(250, 'provisional', '仮。飛び移りチェンジの橋の真ん中の切れ目（調査メモの読み 200〜300mm の真ん中）。長さ・高さはレーンチェンジ（laneChangeLength・laneChangeRise）と同じとして扱う'),
    forkLength: mm(2160, 'provisional', '仮。分岐路の長さ（直線4枚）。調査メモの読み: 上の組は S字＋3レーン直線5枚＋S字'),
    forkSplit: { value: 2, unit: 'count', source: 'provisional', note: '仮。分岐路で左へ上がる組のレーン数（3→2＋1、5レーンの形を3レーンに当てはめた）' },
    forkSep: mm(400, 'provisional', '仮。分岐路で組ごとに横へずれる量（片側）。実物は全体の幅 約5.5mで別々のコースのように走るが、ゲームでは直線の上で横にずらすだけ'),
    forkRise: mm(220, 'provisional', '仮。分岐路で左の組が上がる高さ（スロープ2段分）。右の組は床のまま'),
    twistLength: mm(1620, 'estimated', '部品の長さ＝直線3枚（今のレーンチェンジと同じ長さで差し替えられるように）（ねじれ輪チェンジ。2026-11-16 調査メモ10章の推定、誤差±25〜40%。写真2枚とコース図から）'),
    twistRadius: mm(420, 'estimated', '両端の180度ターンの半径（輪の中心線）。3レーンのいちばん内側のコーナーと同じくらい（ねじれ輪チェンジ。2026-11-16 調査メモ10章の推定、誤差±25〜40%。写真2枚とコース図から）'),
    twistTop: mm(250, 'estimated', '一番高い所（手前のターン）（ねじれ輪チェンジ。2026-11-16 調査メモ10章の推定、誤差±25〜40%。写真2枚とコース図から）'),
    washStep: mm(5, 'estimated', '洗濯板の段差 5mm（10mm×幅55mm の版もある）。2026-11-16 調査メモでは公式の部品の数値とされているが、出典ページはこちらで未確認。ゲームでは低速区間として扱い、段差の高さは記録だけ'),
    washPitch: mm(49, 'estimated', '洗濯板の段差1つの幅 49mm（調査メモでは公式の部品の数値、出典ページは未確認）'),
  },
  5: {
    laneWidth: mm(115, 'official', `1レーンのコース幅 115mm（2/3/5レーン共通）。${URL_LANE}`),
    // レーンの中心どうしの間隔（間の仕切り壁を含む）。3レーンの表には無く、無いときは laneWidth と同じ（lanePitch）
    laneSpacing: mm(130, 'estimated', `推定。115＋仕切り壁15。3レーンの公表の外寸と1周の長さから逆算して矛盾しない値を5レーンにも当てた（店長決定 2026-11-16、後から変える設定値。根拠: /mnt/project-files/racing-game/five-lane/20261116_5レーン寸法調査_v01.md、リポジトリ外）`),
    wallHeight: mm(50, 'official', `フェンス高 50mm（2/3/5レーン共通）。${URL_LANE}`),
    wallThickness: mm(15, 'estimated', `推定（壁の厚み15mm、±5mm）（店長決定 2026-11-16、後から変える設定値。根拠: /mnt/project-files/racing-game/five-lane/20261116_5レーン寸法調査_v01.md、リポジトリ外）`),
    straightLength: mm(1215, 'estimated', `ゲーム補正（540×2.25、135mmの9枚分）。実物の推定は約1225±30（大会のレイアウト図から逆算）（店長決定 2026-11-16、後から変える設定値。根拠: /mnt/project-files/racing-game/five-lane/20261116_5レーン寸法調査_v01.md、リポジトリ外）`),
    cornerCenterRadius: mm(607.5, 'estimated', `ゲーム補正（中央レーンの中心の半径＝直線1枚の半分。各レーン 347.5/477.5/607.5/737.5/867.5）。半分の直線で90度を混ぜた並びも格子に乗って閉じるように、店長決定の620から607.5へ（2026-11-16 店長選択）。実物の推定は600±30（大会図）・620（市販品の外寸から逆算）（店長決定 2026-11-16、後から変える設定値。根拠: /mnt/project-files/racing-game/five-lane/20261116_5レーン寸法調査_v01.md、リポジトリ外）`),
    cornerAngle: deg(45, 'provisional', `${UNCONFIRMED5}（エディタの部品の前提として45度で仮置き）`),
    slopeRise: mm(110, 'provisional', `${UNCONFIRMED5}（3レーンの公式値110を仮置き）`),
    slopeLength: mm(600, 'provisional', `${UNCONFIRMED5}（全長は直線1枚と同じという3レーンの店長の説明を、5レーンの直線1枚の仮値600に当てはめた）`),
    slopeAngle: deg(15, 'provisional', `${UNCONFIRMED5}（3レーンの値を仮置き）`),
    slopeEntryFlat: mm(20, 'provisional', `${UNCONFIRMED5}（3レーンの値を仮置き）`),
    slopeBendRadius: mm(35, 'provisional', `${UNCONFIRMED5}（5レーンは縦の曲がりが3レーンよりきついとの店長の説明により、3レーンの仮値300より小さく仮置き）`),
    bankAngle: deg(20, 'estimated', `2020年の大会レイアウト図の表記「20°バンク」（図の文字。寸法は図から推定）。15・30・45度の部品は弦の長さを同じにして角度だけ変える（仮）`),
    bankChord: mm(607.5, 'estimated', `20度の部品の弦の長さ＝直線の半分。大会図で傾きの付く入口・出口が各半枚（図の色の切り替わり、±1/4枚）。ここから半径を決める（約1749mm）。45度の入口は実物推定1.5枚だが、ゲームは同じ大きさの部品＋直線で組む（仮）`),
    bankBendRadius: mm(500, 'provisional', `${UNCONFIRMED5}（5レーンはループの半径にだけ使う。バンクの部品は bankChord から決める。3レーンの実測値650より小さく仮置き）`),
    waveLength: mm(600, 'provisional', `${UNCONFIRMED5}（直線1枚ぶんと仮定）`),
    waveSwing: mm(40, 'provisional', `${UNCONFIRMED5}（片側へふくらむ幅。3レーンの図面の読み取り40mmを仮置き）`),
    waveCount: cnt(1, 'provisional', `${UNCONFIRMED5}（ふくらみの数。3レーンに合わせて1つ）`),
    laneChangeLength: mm(3645, 'provisional', `${UNCONFIRMED5}（3レーンの店長申告に合わせて直線3枚ぶん＝1215×3と仮定。直線1枚の変更 2026-11-16 に合わせた）`),
    laneChangeRise: mm(100, 'provisional', `${UNCONFIRMED5}（3レーンの店長情報100mmを仮置き）`),
    bumpRise: mm(40, 'provisional', `${UNCONFIRMED5}（バウンドの高さ。公表値なし）`),
    bumpPeak: { value: 0.65, unit: 'count', source: 'provisional', note: `${UNCONFIRMED5}（バウンドの頂点の位置の割合）` },
    tornadoRadiusMul: { value: 2, unit: 'count', source: 'provisional', note: `${UNCONFIRMED5}（3レーンの店長指定値を仮置き）` },
    tornadoCant: deg(20, 'provisional', `${UNCONFIRMED5}（3レーンの店長指定値を仮置き）`),
    tornadoRise: mm(110, 'provisional', `${UNCONFIRMED5}（3レーンの店長指定値を仮置き）`),
    rollCant: deg(5, 'provisional', `${UNCONFIRMED5}（3レーンの値と同じ）`),
    rollRise: mm(110, 'provisional', `${UNCONFIRMED5}（ローリングライズ・フォールの高さ。3レーンの店長指定値を仮置き）`),
    steepRise: mm(220, 'provisional', `${UNCONFIRMED5}（急スロープの高さ。3レーンの店長指定値を仮置き）`),
    steepAngle: deg(30, 'provisional', `${UNCONFIRMED5}（急スロープの斜面の角度）`),
    humpRise: mm(60, 'provisional', `${UNCONFIRMED5}（こぶの高さ。3レーンの45mmを5レーンの直線の長さに合わせて少し上げた仮値、2026-11-16 調査メモ9章）`),
    shiftLength: mm(1450, 'provisional', `${UNCONFIRMED5}（シフトチェンジの長さ。直線1枚＋S字850と仮定）`),
    shiftOffset: mm(230, 'provisional', `${UNCONFIRMED5}（シフトチェンジの横ずれ。2レーンぶんと仮定）`),
    dropRise: mm(600, 'official', '大坂の高さ 600mm（2012年の大会の急な下りの公表値。タミヤ ジャパンカップヒストリー https://www.tamiya.com/japan/mini4wd/mini4news_01 、2026-11-16 調査メモ3章）'),
    dropLength: mm(2430, 'provisional', '仮。大坂の上から見た長さ（直線2枚。調査メモ9章の仮）'),
    dropAngle: deg(40, 'provisional', '仮。大坂の斜面の角度（後の版は角度を緩めたとの伝聞あり）'),
    mtnRise: mm(660, 'provisional', '仮。大山の高さ（スロープ6段分）。実物の公表値は高低差1200mm（報道、調査メモ）だが、空中重力やジャンプ基準が想定していない高さなので660から試す。設定値なので店長の体感で上げる'),
    mtnUpLength: mm(4252.5, 'provisional', '仮。大山の上りの上から見た長さ（直線3.5枚。調査メモの読み: スロープ上り1枚＋橋1枚＋アプローチ1.5枚）'),
    mtnUpAngle: deg(20, 'provisional', '仮。大山の上りの斜面の角度（調査メモの読みで平均約16度）'),
    mtnDownLength: mm(1215, 'provisional', '仮。大山の下りの上から見た長さ（直線1枚。調査メモの読み 0.5〜1.5枚で図から読み切れない）'),
    mtnDownAngle: deg(45, 'provisional', '仮。大山の下りの斜面の角度（調査メモの読みで平均33〜60度）'),
    gapLength: mm(200, 'official', '切れ目ジャンプの切れ目 200mm（1991年の大会の公表値。https://www.tamiya.com/japan/mini4wd/mini4news_01 、調査メモ3章）'),
    gapAngle: deg(5, 'provisional', '仮。切れ目ジャンプで頂上から飛び出す角度（頂上はほぼ水平なので小さめ。飛び方を見て調整）'),
    hopGap: mm(250, 'provisional', '仮。飛び移りチェンジの橋の真ん中の切れ目（調査メモの読み 200〜300mm の真ん中）。長さ・高さはレーンチェンジ（laneChangeLength・laneChangeRise）と同じとして扱う'),
    forkLength: mm(4860, 'provisional', '仮。分岐路の長さ（直線4枚）。調査メモの読み: 上の組は S字＋3レーン直線5枚＋S字'),
    forkSplit: { value: 3, unit: 'count', source: 'provisional', note: '仮。分岐路で左へ上がる組のレーン数（5→3＋2、調査メモ）' },
    forkSep: mm(500, 'provisional', '仮。分岐路で組ごとに横へずれる量（片側）。基本の楕円（向かいの直線まで中心で1215mm）で向かいの路面に当たらない上限に近い値（600だと当たる）。実物は全体の幅 約5.5mで別々のコースのように走るが、ゲームでは直線の上で横にずらすだけ'),
    forkRise: mm(220, 'provisional', '仮。分岐路で左の組が上がる高さ（スロープ2段分）。右の組は床のまま'),
    twistLength: mm(2430, 'estimated', '部品の長さ＝直線2枚（写真で輪の下に直線の継ぎ目が約2枚分）（ねじれ輪チェンジ。2026-11-16 調査メモ10章の推定、誤差±25〜40%。写真2枚とコース図から）'),
    twistRadius: mm(520, 'provisional', '仮。ターンの半径（輪の中心線）。2026-11-16 店長「ただのコーナーとストレートの組み合わせ」に合わせて組み直したとき、輪が左の外へ 2×半径 − 端のレーンの位置 だけはみ出すので、基本の楕円（向かいの直線まで中心で1215mm）に当たらない値にした（540だと2mm当たる）。写真からの推定は540'),
    twistTop: mm(300, 'estimated', '一番高い所（手前のターン。200〜400の推定）（ねじれ輪チェンジ。2026-11-16 調査メモ10章の推定、誤差±25〜40%。写真2枚とコース図から）'),
    washStep: mm(5, 'provisional', `${UNCONFIRMED5}（3レーン用の公式の数値 5mm を仮置き）`),
    washPitch: mm(49, 'provisional', `${UNCONFIRMED5}（3レーン用の公式の数値 49mm を仮置き）`),
  },
};

// 上書きのキー（3レーンと5レーンは別の表なので、レーン数を含める）
export const dimKey = (lanes: LaneCount, key: string) => `${lanes}:${key}`;

// 上書きとして使える値か（有限で0より大きい。山の数は整数）
export function validDimValue(key: string, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return false;
  if (key === 'waveCount') return Number.isInteger(v) && v <= 20;
  return true;
}

// 値だけ。overrides（Layout.dims）にあればそれ、無ければ表の値（無いキーは例外: 打ち間違いを黙って0にしない）
export function dim(lanes: LaneCount, key: string, overrides?: Record<string, number>): number {
  const d = CATALOG[lanes]?.[key];
  if (!d) throw new Error(`寸法表に ${lanes}レーンの ${key} がありません`);
  const o = overrides?.[dimKey(lanes, key)];
  return validDimValue(key, o) ? o : d.value;
}

// コース全体の幅（外側の壁の外から外まで）= レーンの間隔×レーン数 + 外壁の厚み×2。
// 5レーンは1レーンを間隔130の溝として扱い、間の仕切り壁は溝どうしの境目に厚み（間隔−レーン幅）で描く。レーンの中心の半径は中央±130ずつになる
export function trackWidth(lanes: LaneCount, overrides?: Record<string, number>): number {
  return lanes * lanePitch(lanes, overrides) + 2 * dim(lanes, 'wallThickness', overrides);
}

// レーンの中心どうしの間隔。表に laneSpacing があればそれ（5レーン: 仕切り壁込みの130）、無ければレーン幅（3レーン: 今までどおり）
export function lanePitch(lanes: LaneCount, overrides?: Record<string, number>): number {
  return CATALOG[lanes]?.laneSpacing ? dim(lanes, 'laneSpacing', overrides) : dim(lanes, 'laneWidth', overrides);
}
