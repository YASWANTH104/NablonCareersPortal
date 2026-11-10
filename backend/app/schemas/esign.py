from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


PartyRole = Literal["company_signatory", "candidate", "signer", "approver", "viewer"]
DefaultPartyRole = Literal["signer", "approver", "viewer"]


class EsignParty(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    role: PartyRole
    source: Literal["zoho_user", "manual", "candidate", "default"] = "manual"
    # Shown above the signature line for additional signers, e.g. "Reporting Manager"
    title: Optional[str] = Field(default=None, max_length=80)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class EsignSendRequest(BaseModel):
    # List order is the signing order
    parties: list[EsignParty] = Field(min_length=2, max_length=10)
    is_sequential: bool = True
    expiration_days: int = Field(default=14, ge=1, le=90)
    reminder_days: Optional[int] = Field(default=3, ge=1, le=15)
    note: Optional[str] = Field(default=None, max_length=1000)


class EsignDefaultParty(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    role: DefaultPartyRole = "viewer"


class EsignSettingsUpdate(BaseModel):
    signatory_name: Optional[str] = Field(default=None, max_length=255)
    signatory_email: Optional[EmailStr] = None
    default_parties: list[EsignDefaultParty] = Field(default_factory=list, max_length=5)
    expiration_days: int = Field(default=14, ge=1, le=90)
    reminder_days: Optional[int] = Field(default=3, ge=1, le=15)
    note: Optional[str] = Field(default=None, max_length=1000)
