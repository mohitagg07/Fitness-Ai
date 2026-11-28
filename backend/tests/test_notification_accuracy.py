from services.notifications import _has_personalized_nutrition_measurements, _protein_notification


def test_personalized_nutrition_requires_complete_positive_measurements():
    assert _has_personalized_nutrition_measurements({"weight_kg":70,"height_cm":175,"age":24,"gender":"male"})
    assert not _has_personalized_nutrition_measurements({"weight_kg":70,"height_cm":175,"age":24})
    assert not _has_personalized_nutrition_measurements({"weight_kg":0,"height_cm":175,"age":24,"gender":"male"})


def test_protein_push_does_not_use_estimated_or_missing_target():
    assert _protein_notification({"protein_g":70,"logged":True},120) is None
    assert _protein_notification({"protein_g":70,"logged":True},None,True) is None


def test_protein_push_uses_logged_intake_without_food_assumptions():
    result=_protein_notification({"protein_g":70,"logged":True},120,target_is_personalized=True)
    assert result is not None and "50g" in result["body"]
    assert "chicken" not in result["body"].lower() and "yogurt" not in result["body"].lower()
    assert result["data"]["remaining_g"]==50


def test_protein_push_requires_a_real_food_log():
    assert _protein_notification({"protein_g":0,"logged":False},120,True) is None
