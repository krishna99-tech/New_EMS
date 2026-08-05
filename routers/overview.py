from fastapi import APIRouter

from services.overview_service import get_system_overview

router = APIRouter()


@router.get("/api/overview")
def system_overview():
    return get_system_overview()
