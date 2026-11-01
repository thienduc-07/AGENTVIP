from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.app.agent_runtime.skills.skill_loader import skill_loader, SkillDefinition

router = APIRouter(prefix="/skills", tags=["skills"])

class SkillSummary(BaseModel):
    name: str
    description: str
    license: Optional[str] = None
    scripts_count: int
    assigned_agents: List[str]

@router.get("", response_model=List[SkillSummary])
def list_skills():
    """List all available Anthropic skills and their assigned corporate employees"""
    return [
        SkillSummary(
            name=s.name,
            description=s.description,
            license=s.license,
            scripts_count=len(s.scripts),
            assigned_agents=s.assigned_agents,
        )
        for s in skill_loader.list_skills()
    ]

@router.get("/{skill_name}")
def get_skill(skill_name: str):
    """Retrieve full skill documentation and guidelines"""
    skill = skill_loader.get_skill(skill_name)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    return skill

@router.get("/agent/{agent_id}")
def get_agent_skills(agent_id: str):
    """List skills equipped for a specific corporate employee"""
    skills = skill_loader.get_agent_skills(agent_id)
    return [
        SkillSummary(
            name=s.name,
            description=s.description,
            license=s.license,
            scripts_count=len(s.scripts),
            assigned_agents=s.assigned_agents,
        )
        for s in skills
    ]
