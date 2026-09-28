"""NIRF India Rankings 2025 — Engineering category (nirfindia.org), the
official Indian government institutional ranking published by the Ministry
of Education (published 2025-09-04).

Replaces the old static Tier 1-5 college classification in screening_service
(removed 2026-09-27 per explicit instruction: college is no longer a
rejection signal — it only contributes to the composite screening score, and
now via a real published ranking rather than an ad-hoc tier guess).

Two precision levels, matching how NIRF itself publishes this category:
  - Ranks 1-100 are exact, individually ordered (RANK_BY_ALIAS).
  - Ranks 101-150 are published only as a BAND — NIRF does not disclose
    discrete order within it — so those all carry the same "101-150" band
    (BAND_101_150_ALIASES) rather than a fabricated exact number.
Anything not in either list is simply NIRF-unranked (there are thousands of
accredited engineering colleges in India; not being in the top 150 is not
itself a negative signal) — see screening_service.classify_college_nirf for
how that case is scored (AI-assisted estimate, fails open to a neutral
default, never a rejection).

Sources:
  https://www.nirfindia.org/Rankings/2025/EngineeringRanking.html (1-100)
  https://www.nirfindia.org/Rankings/2025/EngineeringRanking150.html (101-150)
"""
import re

NIRF_SOURCE = "NIRF India Rankings 2025 (Engineering), nirfindia.org — published 2025-09-04"
BAND_101_150 = "101-150"


def _norm(s: str) -> str:
    n = s.strip().lower()
    n = re.sub(r"[.,\-()&']", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


# (official name as published, exact rank 1-100, extra common aliases/short-forms)
_RANKED_100: list[tuple[str, int, list[str]]] = [
    ("Indian Institute of Technology Madras", 1, ["iit madras", "iitm", "iit-m"]),
    ("Indian Institute of Technology Delhi", 2, ["iit delhi", "iitd", "iit-d"]),
    ("Indian Institute of Technology Bombay", 3, ["iit bombay", "iitb", "iit-b", "iit mumbai"]),
    ("Indian Institute of Technology Kanpur", 4, ["iit kanpur", "iitk"]),
    ("Indian Institute of Technology Kharagpur", 5, ["iit kharagpur", "iit kgp"]),
    ("Indian Institute of Technology Roorkee", 6, ["iit roorkee"]),
    ("Indian Institute of Technology Hyderabad", 7, ["iit hyderabad", "iith"]),
    ("Indian Institute of Technology Guwahati", 8, ["iit guwahati"]),
    ("National Institute of Technology Tiruchirappalli", 9, ["nit trichy", "nit tiruchirappalli", "nitt"]),
    ("Indian Institute of Technology (Banaras Hindu University) Varanasi", 10, ["iit bhu", "iit bhu varanasi", "iit varanasi"]),
    ("Birla Institute of Technology & Science Pilani", 11, ["bits pilani", "birla institute of technology and science"]),
    ("Indian Institute of Technology Indore", 12, ["iit indore"]),
    ("National Institute of Technology Rourkela", 13, ["nit rourkela"]),
    ("S.R.M. Institute of Science and Technology", 14, ["srm institute of science and technology", "srm university", "srm chennai"]),
    ("Indian Institute of Technology (Indian School of Mines)", 15, ["iit ism dhanbad", "indian school of mines", "iit dhanbad"]),
    ("Vellore Institute of Technology", 16, ["vit vellore", "vellore institute of technology", "vit chennai", "vit"]),
    ("National Institute of Technology Karnataka Surathkal", 17, ["nit surathkal", "nit karnataka", "nitk"]),
    ("Jadavpur University", 18, []),
    ("Indian Institute of Technology Patna", 19, ["iit patna"]),
    ("Anna University", 20, []),
    ("National Institute of Technology Calicut", 21, ["nit calicut", "nitc"]),
    ("Siksha O Anusandhan", 22, ["siksha o anusandhan", "soa university"]),
    ("Amrita Vishwa Vidyapeetham", 23, ["amrita vishwa vidyapeetham", "amrita university"]),
    ("Jamia Millia Islamia", 24, []),
    ("Indian Institute of Technology Gandhinagar", 25, ["iit gandhinagar"]),
    ("Indian Institute of Technology Mandi", 26, ["iit mandi"]),
    ("Indian Institute of Technology Jodhpur", 27, ["iit jodhpur"]),
    ("National Institute of Technology Warangal", 28, ["nit warangal"]),
    ("Thapar Institute of Engineering and Technology", 29, ["thapar institute of engineering and technology", "thapar university", "thapar"]),
    ("Delhi Technological University", 30, ["dtu", "delhi technological university"]),
    ("Chandigarh University", 31, []),
    ("Indian Institute of Technology Ropar", 32, ["iit ropar"]),
    ("Kalasalingam Academy of Research and Education", 33, ["kalasalingam academy of research and education", "kalasalingam university"]),
    ("Aligarh Muslim University", 34, ["amu"]),
    ("Koneru Lakshmaiah Education Foundation", 35, ["koneru lakshmaiah education foundation", "kl university", "k l college of engineering", "klu"]),
    ("Kalinga Institute of Industrial Technology", 36, ["kiit university", "kalinga institute of industrial technology", "kiit"]),
    ("Amity University", 37, ["amity university"]),
    ("International Institute of Information Technology Hyderabad", 38, ["iiit hyderabad", "iiit-h", "international institute of information technology hyderabad"]),
    ("Indian Institute of Technology Bhubaneswar", 39, ["iit bhubaneswar"]),
    ("Shanmugha Arts Science Technology & Research Academy", 40, ["sastra university", "sastra deemed university", "shanmugha arts science technology"]),
    ("Institute of Chemical Technology", 41, ["ict mumbai", "institute of chemical technology"]),
    ("Malaviya National Institute of Technology", 42, ["mnit jaipur", "malaviya national institute of technology"]),
    ("UPES", 43, ["upes", "university of petroleum and energy studies"]),
    ("Visvesvaraya National Institute of Technology Nagpur", 44, ["vnit nagpur", "visvesvaraya national institute of technology"]),
    ("Saveetha Institute of Medical and Technical Sciences", 45, ["saveetha institute of medical and technical sciences"]),
    ("Symbiosis International", 46, ["symbiosis international", "siu"]),
    ("Sri Sivasubramaniya Nadar College of Engineering", 47, ["ssn college of engineering", "sri sivasubramaniya nadar college"]),
    ("Lovely Professional University", 48, ["lpu", "lovely professional university"]),
    ("National Institute of Technology Durgapur", 49, ["nit durgapur"]),
    ("National Institute of Technology Silchar", 50, ["nit silchar"]),
    ("Birla Institute of Technology", 51, ["birla institute of technology mesra", "bit mesra"]),
    ("Graphic Era University", 52, ["graphic era university"]),
    ("National Institute of Technology Patna", 53, ["nit patna"]),
    ("Indian Institute of Engineering Science and Technology Shibpur", 54, ["iiest shibpur", "indian institute of engineering science and technology"]),
    ("Dr. B R Ambedkar National Institute of Technology Jalandhar", 55, ["nit jalandhar", "dr b r ambedkar national institute of technology"]),
    ("Indian Institute of Technology Jammu", 56, ["iit jammu"]),
    ("Indian Institute of Technology Tirupati", 57, ["iit tirupati"]),
    ("Manipal University Jaipur", 58, ["manipal university jaipur"]),
    ("Manipal Institute of Technology", 59, ["manipal institute of technology", "manipal academy of higher education", "mit manipal"]),
    ("Madan Mohan Malaviya University of Technology", 60, ["mmmut", "madan mohan malaviya university of technology"]),
    ("Indian Institute of Space Science and Technology", 61, ["iist", "indian institute of space science and technology"]),
    ("Motilal Nehru National Institute of Technology", 62, ["mnnit allahabad", "motilal nehru national institute of technology"]),
    ("Indraprastha Institute of Information Technology", 63, ["iiit delhi", "iiit-d", "indraprastha institute of information technology"]),
    ("Indian Institute of Technology Palakkad", 64, ["iit palakkad"]),
    ("National Institute of Technology Delhi", 65, ["nit delhi"]),
    ("Sardar Vallabhbhai National Institute of Technology", 66, ["svnit surat", "sardar vallabhbhai national institute of technology"]),
    ("Sathyabama Institute of Science and Technology", 67, ["sathyabama institute of science and technology"]),
    ("PSG College of Technology", 67, ["psg college of technology", "psg tech"]),
    ("International Institute of Information Technology Bangalore", 69, ["iiit bangalore", "iiit-b", "international institute of information technology bangalore"]),
    ("Netaji Subhas University of Technology", 70, ["nsut", "netaji subhas university of technology", "nsit delhi"]),
    ("Banasthali Vidyapith", 71, ["banasthali vidyapith"]),
    ("Indian Institute of Technology Bhilai", 72, ["iit bhilai"]),
    ("National Institute of Technology Srinagar", 73, ["nit srinagar"]),
    ("University of Hyderabad", 74, ["university of hyderabad"]),
    ("M. S. Ramaiah Institute of Technology", 75, ["ms ramaiah institute of technology", "msrit"]),
    ("Christ University", 76, ["christ university"]),
    ("Indian Institute of Technology Dharwad", 77, ["iit dharwad"]),
    ("Rajiv Gandhi Institute of Petroleum Technology", 78, ["rgipt", "rajiv gandhi institute of petroleum technology"]),
    ("Sant Longowal Institute of Engineering & Technology", 79, ["sliet", "sant longowal institute of engineering"]),
    ("Vignan's Foundation for Science, Technology and Research", 80, ["vignan university", "vignans foundation for science technology and research"]),
    ("Maulana Azad National Institute of Technology", 81, ["manit bhopal", "maulana azad national institute of technology"]),
    ("National Institute of Technology Jamshedpur", 82, ["nit jamshedpur"]),
    ("National Institute of Technology Meghalaya", 83, ["nit meghalaya"]),
    ("Jain University", 84, ["jain university"]),
    ("National Institute of Technology Kurukshetra", 85, ["nit kurukshetra"]),
    ("National Institute of Technology Raipur", 86, ["nit raipur"]),
    ("Vel Tech Rangarajan Dr. Sagunthala R&D Institute of Science and Technology", 87, ["vel tech", "vel tech rangarajan"]),
    ("AU College of Engineering", 88, ["au college of engineering", "andhra university college of engineering"]),
    ("Chitkara University", 89, ["chitkara university"]),
    ("COEP Technological University", 90, ["coep pune", "college of engineering pune", "coep technological university"]),
    ("SR University", 91, ["sr university"]),
    ("Defence Institute of Advanced Technology", 92, ["diat", "defence institute of advanced technology"]),
    ("Panjab University", 93, ["panjab university"]),
    ("Jawaharlal Nehru Technological University", 94, ["jntu", "jawaharlal nehru technological university"]),
    ("C.V. Raman Global University", 95, ["cv raman global university"]),
    ("Atal Bihari Vajpayee Indian Institute of Information Technology and Management", 96, ["abv iiitm gwalior", "atal bihari vajpayee indian institute of information technology"]),
    ("National Institute of Technology Hamirpur", 97, ["nit hamirpur"]),
    ("Pandit Deendayal Energy University", 98, ["pdeu", "pandit deendayal energy university"]),
    ("National Institute of Technology Puducherry", 99, ["nit puducherry"]),
    ("Sri Krishna College of Engineering and Technology", 100, ["sri krishna college of engineering and technology"]),
]

# Published only as a band (101-150), not individually ordered by NIRF itself.
_BAND_150: list[tuple[str, list[str]]] = [
    ("Amity University Haryana, Gurgaon", ["amity university haryana"]),
    ("Anurag University", []),
    ("Vishwakarma Institute of Technology", ["bract vishwakarma institute of technology", "vishwakarma institute of technology"]),
    ("Chandigarh Engineering College-CGC Landran Mohali", ["cgc landran"]),
    ("Chennai Institute of Technology", []),
    ("Coimbatore Institute of Technology", ["cit coimbatore"]),
    ("College of Engineering Trivandrum", ["cet trivandrum"]),
    ("Dr. Vishwanath Karad MIT World Peace University", ["mit world peace university", "mit-wpu"]),
    ("Easwari Engineering College", []),
    ("Galgotias University", []),
    ("Gandhi Institute of Technology And Management", ["gitam"]),
    ("Guru Gobind Singh Indraprastha University", ["ggsipu", "ipu delhi"]),
    ("Hindustan Institute of Technology and Science", ["hits chennai"]),
    ("Indian Institute of Information Technology Allahabad", ["iiit allahabad", "triple it allahabad"]),
    ("Indian Institute of Technology Goa", ["iit goa"]),
    ("Jaypee Institute of Information Technology", ["jiit noida"]),
    ("Karunya Institute of Technology and Sciences", ["karunya university"]),
    ("Kongu Engineering College", []),
    ("KPR Institute of Engineering and Technology", []),
    ("Maharishi Markandeshwar", ["mm university mullana"]),
    ("Mahindra University", []),
    ("Manav Rachna International Institute of Research & Studies", ["manav rachna university"]),
    ("Maulana Azad National Urdu University", ["manuu"]),
    ("National Institute of Food Technology Entrepreneurship and Management", ["niftem"]),
    ("National Institute of Technology Agartala", ["nit agartala"]),
    ("National Institute of Technology Arunachal Pradesh", ["nit arunachal pradesh"]),
    ("National Institute of Technology Goa", ["nit goa"]),
    ("National Institute of Technology Mizoram", ["nit mizoram"]),
    ("National Institute of Technology Nagaland", ["nit nagaland"]),
    ("Nirma University", []),
    ("Nitte Meenakshi Institute of Technology", ["nmit bangalore"]),
    ("Noida Institute of Engineering & Technology", ["niet greater noida"]),
    ("Pandit Dwarka Prasad Mishra IIITDM Jabalpur", ["iiitdm jabalpur", "iiit jabalpur"]),
    ("PES University", ["pes university", "pesu", "pes institute of technology"]),
    ("PSG Institute of Technology and Applied Research", ["psg institute of technology and applied research", "psgitech"]),
    ("Punjab Engineering College Chandigarh", ["pec chandigarh"]),
    ("R.V. College of Engineering", ["rv college of engineering", "rvce"]),
    ("Rajalakshmi Engineering College", []),
    ("Sharda University", []),
    ("Shoolini University of Biotechnology and Management Sciences", ["shoolini university"]),
    ("Siddaganga Institute of Technology", ["sit tumkur"]),
    ("SVKM's Narsee Monjee Institute of Management Studies", ["nmims"]),
    ("The Northcap University", ["northcap university"]),
    ("Thiagarajar College of Engineering", ["tce madurai"]),
    ("University College of Engineering", []),
    ("University of Allahabad", []),
    ("Veermata Jijabai Technological Institute", ["vjti mumbai", "veermata jijabai technological institute"]),
]

RANK_BY_ALIAS: dict[str, int] = {}
for _name, _rank, _aliases in _RANKED_100:
    for _a in [_name, *_aliases]:
        RANK_BY_ALIAS[_norm(_a)] = _rank

BAND_101_150_ALIASES: set[str] = set()
for _name, _aliases in _BAND_150:
    for _a in [_name, *_aliases]:
        key = _norm(_a)
        # A name already precisely ranked in the top 100 (a handful of
        # institutes recur across both published pages under slightly
        # different campus names) keeps its exact rank rather than being
        # downgraded to the coarser band.
        if key not in RANK_BY_ALIAS:
            BAND_101_150_ALIASES.add(key)
