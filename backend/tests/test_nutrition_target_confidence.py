from api.routes.nutrition import _nutrition_measurement_confidence


def test_nutrition_targets_are_personalized_only_when_all_required_measurements_exist():
    result = _nutrition_measurement_confidence({
        "weight_kg": 72,
        "height_cm": 175,
        "age": 24,
        "gender": "male",
    })

    assert result["nutrition_target_source"] == "profile"
    assert result["nutrition_target_confidence"] == "personalized"
    assert result["missing_measurements"] == []
    assert set(result["measurement_sources"].values()) == {"profile"}


def test_missing_measurements_keep_nutrition_targets_marked_as_estimated():
    result = _nutrition_measurement_confidence({
        "weight_kg": 72,
        "height_cm": None,
        "age": None,
        "gender": "male",
    })

    assert result["nutrition_target_source"] == "estimated_defaults"
    assert result["nutrition_target_confidence"] == "estimated"
    assert result["missing_measurements"] == ["height_cm", "age"]
    assert result["measurement_sources"]["weight_kg"] == "profile"
    assert result["measurement_sources"]["height_cm"] == "estimated_default"
