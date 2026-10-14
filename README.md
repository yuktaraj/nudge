# Nudge

**An AI-powered personalized study companion that transforms passive reading into active learning.**

Nudge helps students study smarter by combining **AI** with scientifically backed learning techniques such as **active recall**, **spaced repetition**, and **adaptive study scheduling**.

Upload your study materials and let Nudge automatically generate summaries, flashcards, quizzes, and personalized study sessions tailored to your progress.

---

## Features

- Upload PDFs and study materials
- AI-powered content extraction
- Automatic flashcard generation
- AI-generated summaries and notes
- Quiz generation
- Spaced repetition review
- Adaptive study scheduling
- Learning analytics
- Cloud sync with Supabase
- Secure authentication

---

## Tech Stack

### Frontend

- React Native
- Expo
- Expo Router
- TypeScript

### Backend

- Supabase
  - Authentication
  - PostgreSQL
  - Storage
  - Edge Functions

### AI

- Google Gemini

---

## Getting Started

### Clone the repository

```bash
git clone https://github.com/<your-username>/nudge.git
cd nudge
```

### Install dependencies

```bash
npm install
```

### Configure environment variables

Create a `.env` file in the project root.

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

GEMINI_API_KEY=your_gemini_api_key
```

### Run the application

```bash
npx expo start
```

---

## Project Structure

```text
src/
├── app/              # Expo Router screens
├── assets/
├── components/
├── constants/
├── hooks/
└── lib/

supabase/
├── functions/
└── migrations/
```

---

## Environment Variables

| Variable                        | Description            |
| ------------------------------- | ---------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`      | Supabase project URL   |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `GEMINI_API_KEY`                | Google Gemini API key  |

---

## Vision

Nudge aims to replace passive studying with an adaptive learning experience that continuously adjusts to each student's progress, making revision more efficient and effective.

---

## Roadmap

- [x] PDF upload
- [x] AI parsing
- [x] Flashcard generation
- [x] Quiz generation
- [x] Spaced repetition
- [x] Authentication

### Coming Soon

- [ ] Adaptive study planner
- [ ] OCR for scanned notes
- [ ] AI study coach
- [ ] Study streaks
- [ ] Push notifications
- [ ] Offline mode

---

## Contributors

---

## License

This project is licensed under the MIT License.
