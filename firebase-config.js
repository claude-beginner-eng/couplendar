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

const firebaseConfig = {
  apiKey: "여기에_본인_apiKey_붙여넣기",
  authDomain: "여기에_본인_authDomain_붙여넣기",
  projectId: "여기에_본인_projectId_붙여넣기",
  storageBucket: "여기에_본인_storageBucket_붙여넣기",
  messagingSenderId: "여기에_본인_messagingSenderId_붙여넣기",
  appId: "여기에_본인_appId_붙여넣기"
};
