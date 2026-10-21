'use client';

import { FormEvent, useState } from 'react';

const questions = [
  { id: 'q1', text: 'Was kommt zuerst?', answers: ['Software auswählen', 'Problem und Prozess verstehen', 'Rabatt anbieten'], correct: 'Problem und Prozess verstehen' },
  { id: 'q2', text: 'Wann darf ein Partner ein Angebot verkaufen?', answers: ['Sobald er Partner ist', 'Wenn Authorization und Portfolio Permission passen', 'Wenn der Kunde danach fragt'], correct: 'Wenn Authorization und Portfolio Permission passen' },
  { id: 'q3', text: 'Welche ADOREN-Daten dürfen in den Partnerkontext?', answers: ['Alle Antworten', 'Nur freigegebene B2B-Zusammenfassung', 'Private Freitexte'], correct: 'Nur freigegebene B2B-Zusammenfassung' },
];

export function AcademyQuiz() {
  const [score, setScore] = useState<number | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setScore(questions.filter((question) => data.get(question.id) === question.correct).length);
  }

  return (
    <form className="quiz" onSubmit={submit}>
      <span className="eyebrow">Wissenstest</span>
      {questions.map((question, index) => (
        <fieldset key={question.id}>
          <legend>{index + 1}. {question.text}</legend>
          {question.answers.map((answer) => <label key={answer}><input required type="radio" name={question.id} value={answer} /> {answer}</label>)}
        </fieldset>
      ))}
      <button className="button primary" type="submit">Antworten prüfen</button>
      {score !== null && <div className={score === questions.length ? 'success-box' : 'review-notice'}><strong>{score}/{questions.length} richtig</strong><p>{score === questions.length ? 'Review bestanden. In Produktion würde der Abschluss serverseitig auditiert.' : 'Bitte Modulinhalt erneut prüfen.'}</p></div>}
    </form>
  );
}
