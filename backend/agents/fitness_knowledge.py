"""Evidence-backed fitness knowledge retrieval for the VYRN Coach.

Semantic retrieval uses ChromaDB + OpenAI text-embedding-3-small when
OPENAI_API_KEY is configured. Without that key, retrieval explicitly falls
back to local BM25-style keyword search. The corpus is curated and source-linked.
"""
from __future__ import annotations
import logging
import math
import re
from functools import lru_cache
from typing import Any
import httpx
from core.config import get_settings

logger = logging.getLogger(__name__)
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {"a","an","and","are","as","at","be","by","can","do","does","for","from","how","i","in","is","it","me","my","of","on","or","should","the","to","what","when","where","which","with","you","your"}
_SYNONYMS = {
    "muscle":["hypertrophy","strength"], "growing":["hypertrophy","muscle"], "bigger":["hypertrophy","muscle"],
    "bulk":["hypertrophy","muscle"], "protein":["dietary","nutrition","muscle"], "hydration":["water","fluid"],
    "drinking":["water","fluid"], "sleeping":["sleep","bedtime"], "tired":["fatigue","recovery","sleep"],
    "rest":["recovery","sleep"], "cardio":["aerobic","physical","activity"], "walking":["aerobic","physical","activity"],
    "weightlifting":["resistance","training"], "gym":["resistance","training","exercise"],
    "sets":["volume","sets"], "reps":["repetitions"], "sore":["pain","recovery"],
}
FITNESS_KNOWLEDGE: list[dict[str,str]] = [
 {"id":"acsm_resistance_2026","title":"ACSM 2026 resistance-training position stand","category":"strength_hypertrophy_training","url":"https://pubmed.ncbi.nlm.nih.gov/41843416/","content":(
  "The 2026 American College of Sports Medicine position stand summarises resistance-training evidence in healthy adults. For strength, heavier loads around 80% or more of one-repetition maximum, 2–3 sets per exercise and at least two sessions per week were associated with better strength outcomes. For muscle hypertrophy, higher weekly volume around 10 or more sets per muscle group showed a dose-response relationship. Power training uses moderate loads around 30–70% 1RM and fast concentric intent. These are population-level findings, not individual prescriptions; exercise selection, load and volume must account for experience, technique, health, recovery and actual training history."
 )},
 {"id":"who_activity_guidelines","title":"WHO physical-activity recommendations for adults","category":"cardio_general_health","url":"https://www.who.int/initiatives/behealthy/physical-activity","content":(
  "For adults aged 18–64, the World Health Organization recommends at least 150 minutes of moderate-intensity aerobic activity per week, or at least 75 minutes of vigorous-intensity activity, or an equivalent combination. For additional health benefits, moderate activity can be increased toward 300 minutes weekly. Muscle-strengthening activity involving major muscle groups is recommended on two or more days per week. Some activity is better than none. These are public-health guidelines, not a requirement to start at the maximum volume."
 )},
 {"id":"nih_ods_sports_nutrition","title":"NIH ODS: Dietary supplements for exercise and athletic performance","category":"protein_nutrition_supplements","url":"https://ods.od.nih.gov/factsheets/ExerciseandAthleticPerformance-HealthProfessional/","content":(
  "The NIH Office of Dietary Supplements notes that athletes need adequate overall nutrition and hydration. It describes a daily protein range of about 1.2–2.0 grams per kilogram of body weight for athletes, with individual requirements varying by training and context. It summarises professional recommendations for distributing protein across meals and consuming protein around training, but this is not evidence that a narrow post-workout window is mandatory. Food, medical conditions, kidney disease, age, allergies and dietary preferences matter; the coach must not prescribe supplements or clinical diets."
 )},
 {"id":"nhs_hydration_guide","title":"NHS: Water, drinks and hydration","category":"hydration_water","url":"https://www.nhs.uk/Live-well/eat-well/food-guidelines-and-food-labels/water-drinks-nutrition/","content":(
  "The NHS describes 6–8 cups or glasses of fluid per day as a general guide for most people, while noting that needs can be higher in hot environments, during prolonged physical activity, pregnancy, breastfeeding or illness. Water, milk, tea, coffee and other drinks can contribute, as can some foods. The NHS also suggests pale-yellow urine as a practical hydration check. This is general guidance, not an individual fluid prescription. Follow clinician-set fluid limits where relevant."
 )},
 {"id":"cdc_sleep_guidance","title":"CDC: About sleep","category":"sleep_recovery","url":"https://www.cdc.gov/sleep/about/index.html","content":(
  "The CDC states that adults aged 18–60 should generally get at least 7 hours of sleep each day; recommendations differ for other age groups. Helpful sleep habits include consistent bedtimes and wake times, a quiet relaxing cool bedroom, turning off electronic devices at least 30 minutes before bed, and avoiding afternoon or evening caffeine. Sleep needs and sleep quality vary. Persistent insomnia, excessive daytime sleepiness or other sleep concerns warrant discussion with a healthcare professional rather than diagnosis by a fitness chatbot."
 )},
 {"id":"training_safety_scope","title":"VYRN coaching safety and evidence boundaries","category":"pain_injury_safety","url":"https://acsm.org/resistance-training-guidelines-update-2026/","content":(
  "The fitness coach is not a medical diagnostic service. It must not diagnose pain or injury, prescribe rehabilitation, or tell a user to train through sharp, sudden, worsening or function-limiting pain. Stop the aggravating exercise and recommend assessment by a qualified healthcare professional when symptoms are significant, persistent or worsening. Severe symptoms such as chest pain, fainting, severe breathing difficulty, major deformity or inability to use a limb need urgent medical assessment. Never fabricate a safe substitute exercise."
 )},
]

def _tokens(text: str) -> list[str]:
    raw=[t for t in _TOKEN_RE.findall((text or "").lower()) if t not in _STOP_WORDS]
    expanded=list(raw)
    for token in raw: expanded.extend(_SYNONYMS.get(token,[]))
    return expanded

def _lexical_retrieve(query: str, top_k: int) -> list[dict[str,Any]]:
    qtokens=_tokens(query)
    if not qtokens:return []
    docs=FITNESS_KNOWLEDGE
    all_tokens=[_tokens(d["title"]+" "+d["category"]+" "+d["content"]) for d in docs]
    avgdl=sum(len(x) for x in all_tokens)/max(1,len(all_tokens))
    df={}
    for words in all_tokens:
        for word in set(words):df[word]=df.get(word,0)+1
    scored=[]
    for doc,words in zip(docs,all_tokens):
        tf={}
        for word in words:tf[word]=tf.get(word,0)+1
        score=0.0
        for word in set(qtokens):
            count=tf.get(word,0)
            if not count:continue
            idf=math.log(1+(len(docs)-df.get(word,0)+0.5)/(df.get(word,0)+0.5))
            score+=idf*(count*2.2/(count+1.2*(0.25+0.75*len(words)/max(1.0,avgdl))))
        q=query.lower().strip()
        if q and len(q)>=5 and q in (doc["title"].lower()+" "+doc["content"].lower()):score+=2.0
        if score>0:scored.append((score,{**doc,"score":round(score,4),"retrieval_method":"bm25_keyword"}))
    scored.sort(key=lambda item:item[0],reverse=True)
    return [doc for score,doc in scored[:top_k] if score>=0.55]

def _openai_embeddings(texts: list[str]) -> list[list[float]]:
    settings=get_settings()
    if not settings.openai_api_key:raise RuntimeError("OPENAI_API_KEY is not configured")
    response=httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization":f"Bearer {settings.openai_api_key}"},
        json={"model":"text-embedding-3-small","input":texts},timeout=8.0,
    )
    response.raise_for_status()
    rows=sorted(response.json().get("data") or [],key=lambda row:row.get("index",0))
    if len(rows)!=len(texts):raise ValueError("Embedding API returned an unexpected number of vectors")
    return [row["embedding"] for row in rows]

class OpenAIKnowledgeEmbeddingFunction:
    """Chroma adapter for OpenAI text-embedding-3-small."""
    def __call__(self,input:list[str])->list[list[float]]:return _openai_embeddings(input)
    def embed_query(self,input:list[str])->list[list[float]]:return self.__call__(input)
    def name(self)->str:return "openai_text_embedding_3_small_v1"
    def get_config(self)->dict[str,Any]:return {"model":"text-embedding-3-small"}
    @staticmethod
    def build_from_config(config:dict[str,Any])->"OpenAIKnowledgeEmbeddingFunction":
        return OpenAIKnowledgeEmbeddingFunction()

@lru_cache(maxsize=1)
def _semantic_collection():
    settings=get_settings()
    if not settings.openai_api_key:return None
    import chromadb
    client=chromadb.PersistentClient(path=settings.chroma_persist_dir)
    collection=client.get_or_create_collection(
        name="vyrn_fitness_knowledge_openai_v1",
        embedding_function=OpenAIKnowledgeEmbeddingFunction(),
        metadata={"hnsw:space":"cosine","embedding_model":"text-embedding-3-small"},
    )
    existing=set(collection.get().get("ids") or [])
    missing=[doc for doc in FITNESS_KNOWLEDGE if doc["id"] not in existing]
    if missing:
        collection.add(
            ids=[doc["id"] for doc in missing],
            documents=[doc["content"] for doc in missing],
            metadatas=[{"title":doc["title"],"url":doc["url"],"category":doc["category"]} for doc in missing],
        )
    return collection

def retrieve_fitness_knowledge(query:str,top_k:int=4)->list[dict[str,Any]]:
    """Return source-linked chunks; use BM25 if dense retrieval is unavailable."""
    query=(query or "").strip()
    if len(query)<4 or top_k<1:return []
    try:
        collection=_semantic_collection()
        if collection is not None and collection.count()>0:
            result=collection.query(query_texts=[query],n_results=min(top_k,collection.count()),include=["documents","metadatas","distances"])
            docs=[]
            for doc_id,content,meta,distance in zip(
                (result.get("ids") or [[]])[0],
                (result.get("documents") or [[]])[0],
                (result.get("metadatas") or [[]])[0],
                (result.get("distances") or [[]])[0],
            ):
                similarity=max(0.0,min(1.0,1.0-float(distance)))
                if similarity<0.18:continue
                docs.append({"id":doc_id,"title":(meta or {}).get("title","Fitness evidence"),
                    "category":(meta or {}).get("category","general"),"url":(meta or {}).get("url",""),
                    "content":content,"score":round(similarity,4),"retrieval_method":"chroma_openai_semantic"})
            if docs:return docs
    except Exception as exc:
        logger.warning("Fitness semantic retrieval unavailable; using BM25 fallback (%s)",type(exc).__name__)
    return _lexical_retrieve(query,top_k)
