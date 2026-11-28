from agents.fitness_knowledge import _lexical_retrieve, retrieve_fitness_knowledge


def test_fitness_knowledge_retrieves_resistance_training_evidence():
    results = _lexical_retrieve("how many weekly sets for muscle hypertrophy", 3)
    assert results and results[0]["id"] == "acsm_resistance_2026"
    assert results[0]["url"].startswith("https://")
    assert "10 or more sets" in results[0]["content"]


def test_fitness_knowledge_retrieves_sleep_guidance():
    results = _lexical_retrieve("how can I sleep better and what is adult sleep duration", 3)
    assert any(result["id"] == "cdc_sleep_guidance" for result in results)


def test_keyword_fallback_is_explicitly_labelled(monkeypatch):
    from agents import fitness_knowledge
    monkeypatch.setattr(fitness_knowledge, "_semantic_collection", lambda: None)
    results = retrieve_fitness_knowledge("daily water and hydration", 2)
    assert results
    assert all(result["retrieval_method"] == "bm25_keyword" for result in results)
    assert any(result["id"] == "nhs_hydration_guide" for result in results)
