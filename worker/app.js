"use strict";
let material;
const $ = id => document.getElementById(id);
const norm = value => value.normalize("NFKC").toLowerCase();
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
for (const name of ["problem", "reasoning"]) {
  const input = $(name + "-image"), preview = $(name + "-preview");
  let url;
  function clear() {
    if (url) URL.revokeObjectURL(url);
    url = undefined; input.value = ""; preview.replaceChildren(); preview.hidden = true;
  }
  input.addEventListener("change", () => {
    if (url) URL.revokeObjectURL(url);
    const file = input.files[0];
    preview.replaceChildren(); preview.hidden = true;
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10*1024*1024) {
      clear(); $("status").textContent = "10MB以下のJPG・PNG・WebPを選んでください。"; return;
    }
    url = URL.createObjectURL(file);
    const img = el("img");
    img.src = url; img.alt = name === "problem" ? "選んだ問題の写真" : "選んだ途中式の写真";
    img.onerror = () => { clear(); $("status").textContent = "この画像を表示できませんでした。"; };
    const remove = el("button", "写真を外す"); remove.type = "button"; remove.addEventListener("click", clear);
    preview.append(img, remove); preview.hidden = false;
    $("status").textContent = "写真を表示しました。選んだ写真は「問題を解く・考え方を確認する」を押した時に送信できます。";
  });
}
document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => {
  $("question").value = button.dataset.example; $("question").focus();
}));
function noMatch(title, detail) {
  const box = el("div", undefined, "no-match");
  box.append(el("h3", title), el("p", detail)); $("results").append(box);
}
$("form").addEventListener("submit", event => {
  event.preventDefault(); if (!material) return;
  const question = $("question").value.trim();
  if (!question) { $("status").textContent = "探したいテーマを文章で入力してください。写真の読み取りには「問題を解く・考え方を確認する」を使ってください。"; $("question").focus(); return; }
  const query = norm(question), reasoning = norm($("reasoning").value);
  $("results").replaceChildren();
  if (/\bcop\b|成績係数|ヒートポンプ/.test(query)) {
    noMatch("この教材では、COPの説明を確認できません。", "登録済みの範囲は本の2〜17ページです。AIの回答では一般知識から説明できます。必要なら、その後にネット検索も選べます。");
    $("status").textContent = "確認済みの教材範囲にCOPの説明はありません。"; return;
  }
  const matches = material.entries.map(entry => {
    let score = entry.terms.reduce((s,t) => s + (query.includes(norm(t)) ? 3 : 0) + (reasoning.includes(norm(t)) ? 1 : 0), 0);
    if (entry.id === "units" && /\b(w|j|kw|kj)\b/i.test(query)) score += 6;
    return {entry, score};
  }).filter(m => m.score > 0).sort((a,b) => b.score-a.score).slice(0,4);
  if (!matches.length) noMatch("関連するページを見つけられませんでした。", "今は確認済みの見出し・関連語から探しています。「比熱」「第一法則」などの言葉に変えてみてください。検索で見つからないことと、教材に記載がないことは区別します。");
  matches.forEach(({entry}) => {
    const card = el("article", undefined, "reference");
    card.append(el("span", "教科書 p." + entry.pages, "page-tag"), el("h3", entry.title), el("p", entry.summary));
    if (entry.formula) card.append(el("div", entry.formula, "formula"));
    const link = el("a", "教科書 p." + entry.pages + " の内容");
    link.href = "#material-title";
    card.append(link, el("small", "元の教科書PDFは公開していません ／ 説明は教材内容の要約"));
    $("results").append(card);
  });
  $("status").textContent = matches.length ? matches.length + "件の候補が見つかりました。AIによる解答・誤りの判定はまだ行っていません。" : "関連する候補がありません。";
});
fetch("/materials.json").then(r => {
  if (!r.ok) throw new Error("load failed"); return r.json();
}).then(data => {
  material = data; $("material-title").textContent = data.title; $("search").disabled = false;
  $("status").textContent = "";
}).catch(() => { $("status").textContent = "教材を読み込めません。ページを再読み込みしてください。"; });

let sessionToken = null;
let aiBusy = false;
const askButton = $("ask-ai");
const aiStatus = $("ai-status");
let aiResult = $("ai-result");
const conversation = aiResult;
let turns = [];
let original = null;
let firstTurn = null;
const followup = el("form", undefined, "followup");
followup.hidden = true;
const followLabel = el("label","この回答について続けて質問");
followLabel.htmlFor = "followup-question";
const followInput = el("textarea");
followInput.id="followup-question"; followInput.rows=3; followInput.maxLength=5000;
followInput.placeholder="例：なぜここで効率を割るの？ この式の単位を確認したい。";
const followButton=el("button","続けて質問する","primary");
followButton.type="submit";
followup.append(followLabel,followInput,followButton);
conversation.after(followup);
followup.after(aiStatus);
followup.addEventListener("submit",e=>{e.preventDefault();sendQuestion(false,true);});
function formattedText(text) {
  const box=el("div",undefined,"answer-text");
  const pattern=/\[\[式:\s*([\s\S]*?)\]\]/g;
  let cursor=0;
  for(const match of text.matchAll(pattern)){
    if(match.index>cursor) box.append(el("p",text.slice(cursor,match.index).trim()));
    box.append(el("div",match[1].trim(),"formula calculation"));
    cursor=match.index+match[0].length;
  }
  if(cursor<text.length) box.append(el("p",text.slice(cursor).trim()));
  return box;
}
let fallbackRequest = null;
let fallbackToken = null;
const externalPanel = el("aside", undefined, "external-panel");
externalPanel.hidden = true;
externalPanel.append(el("h3","外部資料で確認"));
const externalNotice = el("p","必要な場合だけ、同じ質問をGoogle検索でも確認します。");
const externalButton = el("button","ネットで確認する","primary");
externalButton.type = "button";
const externalOutput = el("div");
externalPanel.append(externalNotice, externalButton, externalOutput);
conversation.after(externalPanel);
function invalidateExternal() {
  fallbackRequest = null; fallbackToken = null; externalPanel.hidden = true;
}
$("form").addEventListener("input", invalidateExternal);
$("form").addEventListener("change", invalidateExternal);
$("form").addEventListener("click", event => {
  if(event.target.closest("[data-example], .preview button")) invalidateExternal();
});
externalButton.addEventListener("click", () => sendQuestion(true));
function answerSection(title, text) {
  const section = el("section", undefined, "answer-section");
  if(!text?.trim()) return;
  section.append(el("h3", title), formattedText(text));
  aiResult.append(section);
}
askButton.addEventListener("click", () => sendQuestion(false));
async function sendQuestion(useExternal = false, isFollowup = false) {
  if (aiBusy || !sessionToken) return;
  if(useExternal && (!fallbackRequest || !fallbackToken)) return;
  if(isFollowup && (!original || !followInput.value.trim())) { followInput.focus(); return; }
  const history = useExternal ? fallbackRequest.history : (isFollowup ? (turns.length<3 ? turns.slice() : [firstTurn,...turns.slice(-2)]) : []);
  const question = isFollowup ? followInput.value.trim() : useExternal ? fallbackRequest.question : ($("question").value.trim() || ($("problem-image").files.length ? "画像の問題を解いてください。考え方・途中計算・単位も説明してください。" : ""));
  const reasoning = isFollowup ? original.reasoning : useExternal ? fallbackRequest.reasoning : $("reasoning").value.trim();
  if (!question) { aiStatus.textContent = "質問を文章で入力してください。"; $("question").focus(); return; }
  aiBusy = true; askButton.disabled = true; externalButton.disabled = true;
  const controls = [...document.querySelectorAll("form input, form textarea, form button")];
  controls.forEach(n => n.disabled = true);
  const images = isFollowup ? original.images : useExternal ? fallbackRequest.images : [];
  try {
    for (const [id,label] of (useExternal || isFollowup ? [] : [["problem-image","problem"],["reasoning-image","reasoning"]])) {
      const file=$(id).files[0];
      if(!file) continue;
      if(file.size>10*1024*1024 || !["image/jpeg","image/png","image/webp"].includes(file.type)) {
        throw new Error("画像は10MB以下のJPG・PNG・WebPを選んでください。");
      }
      const bytes=new Uint8Array(await file.arrayBuffer()), chunks=[];
      for(let i=0;i<bytes.length;i+=0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i,i+0x8000)));
      images.push({label,mime_type:file.type,data:btoa(chunks.join(""))});
    }
  } catch(error) { aiBusy=false; controls.forEach(n=>n.disabled=false); externalButton.disabled=false; aiStatus.textContent=error.message || "写真を読み込めませんでした。"; return; }

  if (!useExternal) { invalidateExternal(); externalOutput.replaceChildren(); }
  let pendingTurn = null;
  if (useExternal) externalOutput.replaceChildren();
  aiStatus.textContent = useExternal ? "ネット検索を使って確認しています…" : "回答を作成しています…";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("/api/ask", {
      method:"POST",
      headers:{"Content-Type":"application/json","X-Session-Token":sessionToken},
      body:JSON.stringify({question,reasoning,images,history,allow_external:useExternal,...(useExternal ? {fallback_token:fallbackToken} : {})}),
      signal:controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "処理に失敗しました。");
    if (useExternal) {
      externalOutput.append(el("p",data.search_used ? "ネット検索を使った補足" : "検索による確認はできませんでした（一般知識による補足）","coverage"));
      const sources = data.external_sources || [];
      const content = el("p",undefined,"external-explanation");
      const text = data.external_explanation;
      const positions = new Map();
      for (const citation of data.citations || []) {
        const start = text.indexOf(citation.text);
        if (start < 0) continue;
        const end = start + citation.text.length;
        positions.set(end, [...new Set([...(positions.get(end) || []), ...citation.source_indices])]);
      }
      let cursor = 0;
      for (const [end, indices] of [...positions.entries()].sort((a,b)=>a[0]-b[0])) {
        content.append(document.createTextNode(text.slice(cursor,end)));
        for (const i of indices) {
          if (!sources[i]) continue;
          const link = el("a", " ["+(i+1)+"]");
          link.href=sources[i].url; link.target="_blank"; link.rel="noopener noreferrer";
          content.append(link);
        }
        cursor=end;
      }
      content.append(document.createTextNode(text.slice(cursor)));
      externalOutput.append(content);
      if (sources.length) {
        externalOutput.append(el("h4","検索で参照した外部資料"));
        sources.forEach((source,i) => {
          const card = el("article",undefined,"reference");
          const link = el("a","["+(i+1)+"] "+source.title+" ↗");
          link.href=source.url; link.target="_blank"; link.rel="noopener noreferrer";
          card.append(link); externalOutput.append(card);
        });
        externalOutput.append(el("small","番号の付いた説明と出典が対応しています。計算結果まで資料に記載されているとは限りません。"));
      } else externalOutput.append(el("p","外部出典を取得できていません。検索で検証済みの回答としては扱わないでください。","source-note"));
      if (data.search_entry_html) {
        const frame = el("iframe");
        frame.title="Googleの検索候補";
        frame.className="search-suggestions";
        frame.setAttribute("sandbox","allow-popups allow-popups-to-escape-sandbox");
        frame.srcdoc=data.search_entry_html;
        externalOutput.append(frame);
      }
      if(turns.length) turns[turns.length-1].answer=(turns[turns.length-1].answer+"\n外部資料による補足:\n"+data.external_explanation).slice(-12000);
      externalButton.hidden = true;
      aiStatus.textContent = "補足を受け取りました。追加送信は1回です。";
      return;
    }
    if (data.fallback_token) {
      fallbackRequest={question,reasoning,images,history}; fallbackToken=data.fallback_token;
      externalPanel.hidden=false; externalButton.hidden=false;
    }
    if(!isFollowup) { conversation.replaceChildren(); turns=[]; original={question,reasoning,images}; }
    pendingTurn=el("article",undefined,"conversation-turn");
    pendingTurn.append(el("h3",isFollowup ? "追加の質問" : "質問","turn-label"),el("p",question,"user-question"));
    conversation.append(pendingTurn); aiResult=pendingTurn;
    const labels = {supported:"教材を参照",partial:"教材の参照・一般知識",not_found:"一般知識による回答 · 教材に該当なし"};
    aiResult.append(el("p", labels[data.coverage] || "AIの回答", "coverage"));
    if (data.problem_reading && images.length) answerSection("問題の条件", data.problem_reading);
    answerSection("考え方", data.approach);
    if(reasoning || images.some(i=>i.label==="reasoning") || isFollowup) answerSection("考え方の確認", data.feedback);
    answerSection("計算と答え", data.answer);
    if (data.limitations) answerSection("確認できないこと・補足",data.limitations);
    const answerBody=aiResult;
    if (data.sources.length) {
      const refs=el("details",undefined,"answer-details"); refs.append(el("summary","参照した教材")); answerBody.append(refs); aiResult=refs;
      
      data.sources.forEach(source => {
        const card = el("article",undefined,"reference");
        card.append(el("span","教科書 p."+source.pages,"page-tag"),el("h3",source.title),el("p",source.summary));
        if(source.formula) card.append(el("div",source.formula,"formula"));
        const link = el("a","教科書 p." + source.pages + " の内容");
        link.href = "#material-title";
        card.append(link,el("small",data.material_title+" ／ PDFは公開していません"));
        aiResult.append(card);
      });
    }
    aiResult=answerBody;
    if (data.recommendations?.length) {
      const review=el("details",undefined,"answer-details"); review.append(el("summary","復習するページ")); answerBody.append(review); aiResult=review;
      
      for (const source of data.recommendations) {
        const card=el("article",undefined,"reference");
        card.append(el("span","教科書 p."+source.pages,"page-tag"),el("h3",source.title),el("p",source.reason));
        const link=el("a","教科書 p."+source.pages+" の内容");
        link.href="#material-title";
        card.append(link); aiResult.append(card);
      }
      aiResult.append(el("small","演習は同テーマの復習候補です。個別の設問が同じ解法かどうかは未確認です。"));
    }
    aiResult=answerBody;
    const summary=[data.problem_reading,data.approach,data.feedback,data.answer,data.limitations].filter(Boolean).join("\n\n").slice(0,12000);
    const turn={question,answer:summary}; if(!isFollowup) firstTurn=turn;
    turns.push(turn); turns=turns.slice(-3);
    followup.hidden=false; followInput.value="";
    pendingTurn.scrollIntoView({behavior:"smooth",block:"start"});
    aiStatus.textContent = "";
  } catch(error) {
    aiStatus.textContent = error.name === "AbortError"
      ? "応答待ちを終了しました。自動再送はしていません。送信済みの分が利用量に計上される場合があります。"
      : (error.message === "Failed to fetch" ? "接続できません。通信状態を確認してから再度お試しください。" : error.message);
  } finally {
    clearTimeout(timeout); aiBusy=false;
    controls.forEach(n=>n.disabled=false);
    externalButton.disabled=false;
  }
}
fetch("/api/session").then(r => {
  if (!r.ok) throw new Error(); return r.json();
}).then(data => {
  sessionToken=data.token;
  askButton.disabled=!data.ready;
  aiStatus.textContent=data.ready
    ? ""
    : "サーバーのAPI設定が未完了です。";
}).catch(() => { aiStatus.textContent="接続の準備ができませんでした。ページを再読み込みしてください。"; });
