// TODO: Implement Nodemailer for sending emails in SMTP server private, with SSL
// import nodemailer from 'nodemailer';
// Task blocked for not having it on roadmap
/*
async function sendEmail() {
  // 1. Configurar o transportador SMTP
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'seu.email@gmail.com', // Seu Gmail
      pass: 'sua-senha-de-app'    // Senha de App criada no passo 1
    }
  });

  // 2. Definir o conteúdo do e-mail
  const mailOptions = {
    from: '"Nome" <seu.email@gmail.com>',
    to: 'destinatario@gmail.com',
    subject: 'Assunto do E-mail',
    text: 'Olá, teste de envio de e-mail com TS!',
    html: '<h1>Olá</h1><p>Teste de envio de e-mail com TS!</p>'
  };

  // 3. Enviar o e-mail
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('E-mail enviado:', info.messageId);
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
  }
}

sendEmail();
*/