// 🔥 Firebase 설정 파일
// ------------------------------------------------------------
// Firebase 콘솔(console.firebase.google.com)에서
// 프로젝트 설정 > 내 앱 > 웹 앱 추가 하면 이것과 똑같이 생긴
// firebaseConfig 값을 보여줘요. 그걸 그대로 복사해서
// 아래 6개 항목만 바꿔치기 하면 됩니다.
//
// ⚠️ 이 파일은 GitHub에 올려도 괜찮아요. 이 값들은 "비밀키"가
// 아니라 "이 앱이 어느 프로젝트에 연결되는지" 알려주는 공개 정보예요.
// 진짜 보안은 Firestore 쪽 "규칙(rules)"에서 관리해요.
// ------------------------------------------------------------

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBvVzwLmWqAkKwYMkDuB-qj1slMkw0ukEI",
  authDomain: "couplendar-cae52.firebaseapp.com",
  projectId: "couplendar-cae52",
  storageBucket: "couplendar-cae52.firebasestorage.app",
  messagingSenderId: "29564185190",
  appId: "1:29564185190:web:a22c956f86d947ecd8dba7",
  measurementId: "G-JZY1T5D1HV"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);